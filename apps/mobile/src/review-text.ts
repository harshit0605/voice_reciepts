/**
 * Review titles and details are written in English by the engine and the API. Translate the known
 * ones at display time, keeping batch codes, names and numbers exactly as recorded.
 */
const titles: Record<string, string> = {
  "Offline stock conflict": "ऑफ़लाइन स्टॉक में टकराव",
  "Offline price needs review": "ऑफ़लाइन भाव की जाँच चाहिए",
  "Ambiguous counter interaction": "काउंटर की गतिविधि साफ़ नहीं",
  "Interaction without a matched bill": "बिना बिल मिलान की गतिविधि",
  "Monitoring coverage gap": "निगरानी में खाली समय",
  "EOD report revised": "दिन की रिपोर्ट बदली गई",
  "Duplicate UPI reference was blocked": "दोहराया गया UPI रेफ़रेंस रोका गया",
  "Offline sale requires recovery": "ऑफ़लाइन बिक्री को वापस लाना है",
  "Gateway backup requires recovery": "दुकान के बैकअप से वापस लाना है",
};
const details: [RegExp, (m: RegExpMatchArray) => string][] = [
  [
    /^(.+?): sold (\d+(?:\.\d+)?), recorded stock (-?\d+(?:\.\d+)?)\. Physical count required\.$/,
    (m) => `${m[1]}: ${m[2]} बिके, दर्ज स्टॉक ${m[3]}। असली गिनती ज़रूरी है।`,
  ],
  [
    /^Preserved the issued bill for (.+); cached price or tax differs\.$/,
    (m) =>
      `${m[1]} के लिए जारी बिल जैसा था वैसा रखा गया; सेव किया भाव या टैक्स अलग है।`,
  ],
  [
    /^Silent pilot observation; a purchase and employee identity are not established\.$/,
    () => "चुपचाप जाँच का अवलोकन; खरीद और कर्मचारी की पहचान पक्की नहीं है।",
  ],
  [
    /^A transaction updated (.+); revision (\d+) preserves earlier reports\.$/,
    (m) =>
      `${m[1]} को लेन-देन बदला; संशोधन ${m[2]} पुरानी रिपोर्ट सुरक्षित रखता है।`,
  ],
  [
    /^(.+?) attempted to reuse a UPI reference\. No new invoice or collection was posted; check the merchant records\.$/,
    (m) =>
      `${m[1]} ने वही UPI रेफ़रेंस दोबारा इस्तेमाल करने की कोशिश की। कोई नया बिल या वसूली दर्ज नहीं हुई; मर्चेंट रिकॉर्ड जाँचें।`,
  ],
  [
    /^Recovered from shop gateway backup; verify original bill and collection before posting$/,
    () =>
      "दुकान के गेटवे बैकअप से वापस लाया गया; दर्ज करने से पहले असली बिल और वसूली जाँचें",
  ],
];
export function reviewTitle(title: string, hi: boolean) {
  return hi ? (titles[title] ?? title) : title;
}
export function reviewDetail(detail: string, hi: boolean) {
  if (!hi) return detail;
  for (const [pattern, build] of details) {
    const m = detail.match(pattern);
    if (m) return build(m);
  }
  return detail;
}
const reasons: Record<string, string> = {
  "Customer requested credit": "ग्राहक ने उधार माँगा",
  "Customer discount request": "ग्राहक ने छूट माँगी",
};
export function approvalReason(reason: string, hi: boolean) {
  return hi ? (reasons[reason] ?? reason) : reason;
}
