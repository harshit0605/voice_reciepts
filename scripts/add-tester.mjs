// Gives someone the iPhone app through TestFlight.
//
//   node scripts/add-tester.mjs name@example.com First Last
//
// TestFlight's internal testers must be members of the App Store Connect team, so the first run
// invites the person (Marketing role, this app only) and Apple emails them. Once they have
// accepted, run it again: it adds them to the "Shop" group, which gets every build, and TestFlight
// emails them how to install. Needs an Admin API key in .data/apple/asc.json.
import { api, asc, saveAsc } from "./app-store-connect.mjs";

const [email, firstName, lastName] = process.argv.slice(2);
if (!email?.includes("@") || !firstName || !lastName) {
  console.error("Use: node scripts/add-tester.mjs name@example.com First Last");
  process.exit(1);
}
const app = { type: "apps", id: asc.appAppleId };

// The internal group every build goes to.
let groupId = asc.testflightGroupId;
if (!groupId) {
  const groups = await api(
    "GET",
    `/apps/${asc.appAppleId}/betaGroups?fields[betaGroups]=name,isInternalGroup`,
  );
  groupId =
    groups.data.find(
      (g) => g.attributes.isInternalGroup && g.attributes.name === "Shop",
    )?.id ??
    (
      await api("POST", "/betaGroups", {
        data: {
          type: "betaGroups",
          attributes: {
            name: "Shop",
            isInternalGroup: true,
            hasAccessToAllBuilds: true,
          },
          relationships: { app: { data: app } },
        },
      })
    ).data.id;
  asc.testflightGroupId = groupId;
  saveAsc();
}

const query = encodeURIComponent(email);
const user = (await api("GET", `/users?filter[username]=${query}`)).data[0];
if (user) {
  const existing = (await api("GET", `/betaTesters?filter[email]=${query}`))
    .data[0];
  if (existing)
    await api("POST", `/betaGroups/${groupId}/relationships/betaTesters`, {
      data: [{ type: "betaTesters", id: existing.id }],
    });
  else
    await api("POST", "/betaTesters", {
      data: {
        type: "betaTesters",
        attributes: { email, firstName, lastName },
        relationships: {
          betaGroups: { data: [{ type: "betaGroups", id: groupId }] },
        },
      },
    });
  console.log(
    `${email} is in the TestFlight group. TestFlight emails them; they install Apple's TestFlight app and open the invitation on their iPhone.`,
  );
} else {
  const invited = (await api("GET", `/userInvitations?filter[email]=${query}`))
    .data[0];
  if (!invited)
    await api("POST", "/userInvitations", {
      data: {
        type: "userInvitations",
        attributes: {
          email,
          firstName,
          lastName,
          roles: ["MARKETING"],
          allAppsVisible: false,
          provisioningAllowed: false,
        },
        relationships: { visibleApps: { data: [app] } },
      },
    });
  console.log(
    `${invited ? "Already invited" : "Invited"} ${email} to the App Store Connect team (this app only). ` +
      "They accept the email from Apple (signing in with that Apple ID), then run this again.",
  );
}
