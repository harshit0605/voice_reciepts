import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Pressable,
  Platform,
  AppState,
  ActivityIndicator,
} from "react-native";
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";
import * as FileSystem from "expo-file-system";
import { useSession, uid, isConnectionLost } from "./session";
import { appendFile } from "./upload";
import {
  Txt,
  Button,
  Field,
  Row,
  Badge,
  Sheet,
  Icon,
  palette,
  toneInk,
  type Tone,
  Notice,
  useWord,
  clock,
} from "./ui";
import {
  readableQuantity,
  readableUnit,
  spokenItemTitle,
  NO_MEDICINES_WARNING,
  applyVoiceResult,
  emptyVoice,
  parseExactSaleText,
  voiceCandidates,
  type VoiceWork,
  type SpokenItem,
} from "@counterwell/core";
/** A notice band inside the selling sheets: waiting by default, with space below. */
export function Strip({
  tone = "waiting",
  alert = false,
  ...rest
}: React.ComponentProps<typeof Notice>) {
  return <Notice tone={tone} alert={alert} spaced {...rest} />;
}
type Change = (fn: (v: VoiceWork) => VoiceWork) => Promise<boolean>;
export function VoiceEntry({
  work,
  change,
  visible,
  close,
  onPick,
}: {
  work: VoiceWork;
  change: Change;
  visible: boolean;
  close: () => void;
  onPick: (id: string, productId: string) => void;
}) {
  const s = useSession(),
    t = (en: string, hi: string) => (s.language === "hi" ? hi : en),
    w = useWord();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY),
    audio = useAudioRecorderState(recorder, 200);
  const [recording, setRecording] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [jobs, setJobs] = useState<any[]>([]),
    [pendingAudio, setPendingAudio] = useState<{
      uri: string;
      seconds: number;
    } | null>(null),
    [discard, setDiscard] = useState(false),
    [addingMore, setAddingMore] = useState(false),
    [editingItemId, setEditingItemId] = useState<string | null>(null);
  const current = useRef(work),
    changeRef = useRef(change),
    request = useRef(s.request),
    lock = useRef(false),
    recordingRef = useRef(false),
    mounted = useRef(true),
    localUri = useRef<string | null>(null);
  current.current = work;
  changeRef.current = change;
  request.current = s.request;
  const clearAudio = async () => {
    const uri = localUri.current;
    localUri.current = null;
    if (uri && Platform.OS !== "web") {
      const f = new FileSystem.File(uri);
      if (f.exists) f.delete();
    }
    if (mounted.current) setPendingAudio(null);
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void (async () => {
        try {
          if (recordingRef.current) await recorder.stop();
        } catch {
        } finally {
          try {
            await setAudioModeAsync({ allowsRecording: false });
            await clearAudio();
          } catch {}
        }
      })();
    };
  }, []);
  useEffect(() => {
    if (!visible || s.demo) return;
    let live = true;
    void request
      .current("/voice-jobs")
      .then((r) => {
        if (live) setJobs(r.jobs);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [visible, s.demo, work.jobId]);
  useEffect(() => {
    if (!work.jobId) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await request.current(`/extractions/${work.jobId}`);
        if (!live) return;
        if (result.status === "completed") {
          await changeRef.current((v) => ({
            ...applyVoiceResult(v, result.id, result.output, uid),
            input: "",
          }));
          setError("");
          setAddingMore(false);
        } else if (result.status === "failed") {
          await changeRef.current((v) => ({
            ...v,
            jobId: undefined,
            input: result.transcript ?? v.input,
            transcript: result.transcript ?? v.transcript,
            error: result.error,
          }));
        } else timer = setTimeout(poll, 1000);
      } catch (e) {
        if (live) {
          // A dropped poll is retried; the header says when the phone is really offline.
          if (!isConnectionLost(e)) setError((e as Error).message);
          timer = setTimeout(poll, 5000);
        }
      }
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [work.jobId]);
  async function prepareText() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const text = current.current.input.trim();
      if (!text)
        throw new Error(
          t("Enter sale items first", "पहले बिक्री का सामान लिखें"),
        );
      const draft = parseExactSaleText(text, Object.values(s.state!.products));
      if (draft) {
        await change((v) => ({
          ...applyVoiceResult(
            v,
            `local:${uid()}`,
            { transcript: text, draft },
            uid,
          ),
          input: "",
          source: "local",
        }));
        setAddingMore(false);
        return;
      }
      // Without the internet nothing else can read this text, so say which line failed.
      const products = Object.values(s.state!.products);
      const badLine = text
        .split(/[;\n]+/)
        .map((l) => l.trim())
        .filter(Boolean)
        .find((l) => !parseExactSaleText(l, products));
      if (badLine && (s.demo || !s.online))
        throw new Error(
          t(
            `Could not match "${badLine}". Write each item as exact name, quantity and unit, like "Dolo 650 mg 2 strip", with a ; between items.`,
            `"${badLine}" पहचान में नहीं आया। हर सामान ऐसे लिखें: पूरा नाम, मात्रा, इकाई ("Dolo 650 mg 2 strip"), और सामान के बीच ; लगाएँ।`,
          ),
        );
      if (s.demo)
        throw new Error(
          t(
            "Try the example format, or load the sample review. Cloud extraction needs a connected shop.",
            "उदाहरण के अनुसार लिखें या नमूना समीक्षा खोलें। क्लाउड के लिए दुकान से जुड़ना ज़रूरी है।",
          ),
        );
      const job = await s.request("/extractions/text", {
        method: "POST",
        body: JSON.stringify({ text, saleId: current.current.id }),
      });
      await change((v) => ({ ...v, jobId: job.id, error: undefined }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function uploadAudio(value: { uri: string; seconds: number }) {
    const form = new FormData();
    form.append("kind", "voice");
    form.append("saleId", current.current.id);
    form.append(
      "recordedSeconds",
      String(Math.max(0.1, Math.min(30, value.seconds))),
    );
    if (Platform.OS === "web")
      form.append("file", await (await fetch(value.uri)).blob(), "sale.webm");
    else await appendFile(form, "file", value.uri, "sale.m4a", "audio/mp4");
    const job = await request.current("/extractions", {
      method: "POST",
      body: form,
    });
    await changeRef.current((v) => ({ ...v, jobId: job.id, error: undefined }));
    await clearAudio();
  }
  async function stop(upload: boolean) {
    if (lock.current || !recordingRef.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const seconds = audio.durationMillis / 1000;
      await recorder.stop();
      recordingRef.current = false;
      setRecording(false);
      await setAudioModeAsync({ allowsRecording: false });
      if (recorder.uri) {
        localUri.current = recorder.uri;
        const value = { uri: recorder.uri, seconds };
        setPendingAudio(value);
        if (upload) await uploadAudio(value);
        else await clearAudio();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => {
    if (!recording) return;
    const timer = setTimeout(() => void stopRef.current(true), 28000);
    return () => clearTimeout(timer);
  }, [recording]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      // "inactive" is also what iOS reports while a system prompt (the microphone permission) is
      // showing; only a real move to the background is an interruption.
      if (state === "background" && recordingRef.current) {
        void stopRef.current(false);
        setError(
          t(
            "Recording stopped when the app left the foreground. Record again.",
            "ऐप पीछे जाने पर रिकॉर्डिंग रुक गई। दोबारा रिकॉर्ड करें।",
          ),
        );
      }
    });
    return () => sub.remove();
  }, []);
  async function start() {
    if (lock.current) return;
    lock.current = true;
    setError("");
    try {
      if (s.demo)
        throw new Error(
          t(
            "Use the labelled sample in this demo. Recording requires a connected shop.",
            "इस डेमो में नमूना इस्तेमाल करें। रिकॉर्डिंग के लिए दुकान से जुड़ें।",
          ),
        );
      if (!s.online)
        throw new Error(
          t(
            "Speech needs internet. Type items or use search while offline.",
            "आवाज़ के लिए इंटरनेट चाहिए। ऑफलाइन में लिखें या खोजें।",
          ),
        );
      // Confirm the permission first, so the system prompt never appears mid-recording.
      const permission = await getRecordingPermissionsAsync();
      if (!(
        permission.granted || (await requestRecordingPermissionsAsync()).granted
      ))
        throw new Error(
          t(
            "Microphone access was declined. You can still type items.",
            "माइक की अनुमति नहीं मिली। आप सामान लिख सकते हैं।",
          ),
        );
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await recorder.prepareToRecordAsync();
      recorder.record();
      recordingRef.current = true;
      setRecording(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
    }
  }
  const patchItem = (id: string, patch: Partial<SpokenItem>) =>
    void change((v) => ({
      ...v,
      items: v.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    }));
  return (
    <Sheet
      visible={visible}
      title={t("Voice & text entry", "बोलकर या लिखकर जोड़ें")}
      onClose={() => {
        if (recordingRef.current) void stop(false);
        close();
      }}
    >
      <View style={{ gap: 16 }}>
        <Row style={{ justifyContent: "space-between" }}>
          <Badge tone="waiting">
            {t(
              "Draft only · confirm before billing",
              "केवल ड्राफ्ट · बिल से पहले पुष्टि करें",
            )}
          </Badge>
          <Txt muted size={13} num>
            {work.items.length} {t("to review", "जाँच बाकी")}
          </Txt>
        </Row>
        {(!!error || !!work.error) && (
          <Strip tone="declined" alert>
            {error || work.error}
          </Strip>
        )}
        {work.items.length > 0 &&
        !addingMore &&
        !recording &&
        !pendingAudio &&
        !work.jobId &&
        !work.error ? (
          <Button secondary small onPress={() => setAddingMore(true)}>
            {t("Add more by voice or text", "बोलकर या लिखकर और जोड़ें")}
          </Button>
        ) : (
          <>
            {recording ? (
              <View
                style={{ alignItems: "center", gap: 10, paddingVertical: 8 }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t(
                    "Stop & prepare items",
                    "रोकें और सामान तैयार करें",
                  )}
                  onPress={() => void stop(true)}
                  style={({ pressed }) => ({
                    width: 96,
                    height: 96,
                    borderRadius: 48,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: pressed ? "#9E2A20" : palette.declined,
                    borderWidth: 4,
                    borderColor: palette.declinedTint,
                  })}
                >
                  <Icon name="stop" size={40} color="#FFFFFF" />
                </Pressable>
                <Txt size={16} weight={600} color={palette.declined} center>
                  {t(
                    "Recording… tap to stop",
                    "रिकॉर्ड हो रहा है… रोकने के लिए दबाएँ",
                  )}
                </Txt>
                <Txt size={19} weight={600} num>
                  {Math.floor(audio.durationMillis / 1000)} / 28 s
                </Txt>
                <Button variant="quiet" onPress={() => void stop(false)}>
                  {t("Cancel recording", "रिकॉर्डिंग रद्द करें")}
                </Button>
              </View>
            ) : (
              <View
                style={{ alignItems: "center", gap: 10, paddingVertical: 8 }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t(
                    "Record sale items",
                    "बिक्री का सामान बोलें",
                  )}
                  accessibilityState={{
                    disabled: busy || !!work.jobId || !!pendingAudio,
                  }}
                  disabled={busy || !!work.jobId || !!pendingAudio}
                  onPress={() => void start()}
                  style={({ pressed }) => ({
                    width: 96,
                    height: 96,
                    borderRadius: 48,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: pressed
                      ? palette.bluePressed
                      : palette.blue,
                    borderWidth: 4,
                    borderColor: palette.blueTint,
                    opacity: busy || !!work.jobId || !!pendingAudio ? 0.4 : 1,
                  })}
                >
                  <Icon name="mic" size={42} color="#FFFFFF" />
                </Pressable>
                <Txt size={16} weight={600} center>
                  {t("Record sale items", "बिक्री का सामान बोलें")}
                </Txt>
              </View>
            )}
            {pendingAudio && !recording && (
              <View style={{ gap: 10 }}>
                <Strip tone="waiting" icon="cloud-upload-outline">
                  {t(
                    "Upload did not finish. Retry before leaving this screen, or type the items below.",
                    "अपलोड पूरा नहीं हुआ। स्क्रीन छोड़ने से पहले फिर प्रयास करें या नीचे लिखें।",
                  )}
                </Strip>
                <Button
                  disabled={busy}
                  secondary
                  onPress={() =>
                    void (async () => {
                      if (lock.current) return;
                      lock.current = true;
                      setBusy(true);
                      try {
                        await uploadAudio(pendingAudio);
                        setError("");
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        lock.current = false;
                        setBusy(false);
                      }
                    })()
                  }
                >
                  {t("Retry audio upload", "आवाज़ फिर अपलोड करें")}
                </Button>
                <Button variant="quiet" onPress={() => void clearAudio()}>
                  {t("Discard recording", "रिकॉर्डिंग हटाएँ")}
                </Button>
              </View>
            )}
            {!!work.jobId ? (
              <View style={{ gap: 8, alignItems: "center" }}>
                <ActivityIndicator color={palette.blue} />
                <Txt center color={palette.ink2}>
                  {t(
                    "Preparing items. You can close this screen and resume later.",
                    "सामान तैयार हो रहा है। स्क्रीन बंद करके बाद में वापस आ सकते हैं।",
                  )}
                </Txt>
              </View>
            ) : (
              <>
                <Field
                  multiline
                  label={t(
                    "Type, paste or use keyboard dictation",
                    "लिखें, पेस्ट करें या कीबोर्ड से बोलें",
                  )}
                  value={work.input}
                  onChange={(input) =>
                    void change((v) => ({ ...v, input, error: undefined }))
                  }
                  placeholder="Dolo 650 mg 6 goli; ORS 21 g 1 sachet"
                />
                <Txt muted size={13}>
                  {t(
                    "Separate items with a semicolon. Exact catalogue names, strengths, quantities and units work offline. Other text needs internet. Use Edit details to correct an existing item.",
                    "सामान को सेमीकोलन से अलग करें। सही कैटलॉग नाम, ताकत, मात्रा और इकाई ऑफलाइन काम करते हैं। अन्य पाठ के लिए इंटरनेट चाहिए। सुधार के लिए विवरण बदलें।",
                  )}
                </Txt>
                <Button
                  secondary
                  disabled={busy || recording || !work.input.trim()}
                  onPress={() => void prepareText()}
                >
                  {t("Prepare typed items", "लिखे सामान तैयार करें")}
                </Button>
              </>
            )}
            {s.demo && (
              <Button
                secondary
                small
                disabled={!!work.jobId || busy}
                onPress={() =>
                  void change((v) => ({
                    ...applyVoiceResult(
                      v,
                      `sample:${uid()}`,
                      {
                        transcript: "Dolo 650 mg six goli; ORS 21 g one packet",
                        draft: {
                          items: [
                            {
                              name: "Dolo",
                              strength: "650 mg",
                              form: "tablet",
                              quantity: "six",
                              unit: "goli",
                              uncertain: false,
                            },
                            {
                              name: "ORS",
                              strength: "21 g",
                              form: "sachet",
                              quantity: "1",
                              unit: "packet",
                              uncertain: true,
                            },
                          ],
                          warnings: [
                            "Synthetic review example — no speech or AI call was made.",
                          ],
                        },
                      },
                      uid,
                    ),
                    source: "sample",
                  }))
                }
              >
                {t("Load sample voice review", "आवाज़ की नमूना समीक्षा खोलें")}
              </Button>
            )}
          </>
        )}
        {!!work.transcript && (
          <View style={{ gap: 4 }}>
            <Txt weight={600} size={14}>
              {t("Original text", "मूल पाठ")}
            </Txt>
            <Txt color={palette.ink2} size={14}>
              {work.transcript}
            </Txt>
            <Txt muted size={13}>
              {work.source === "local"
                ? t(
                    "Read on this phone · nothing sent out",
                    "इसी फ़ोन पर पढ़ा गया · कुछ बाहर नहीं भेजा गया",
                  )
                : work.source === "sample"
                  ? t("Synthetic sample", "नमूना डेटा")
                  : t(
                      "Draft from the voice service · you must confirm",
                      "आवाज़ सेवा से बना ड्राफ्ट · आपकी पुष्टि ज़रूरी",
                    )}
            </Txt>
          </View>
        )}
        {work.warnings.map((w, i) => (
          <Strip key={i} tone="waiting">
            {w === NO_MEDICINES_WARNING
              ? t(
                  NO_MEDICINES_WARNING,
                  "रिकॉर्डिंग में कोई दवा नहीं सुनाई दी। फ़ोन के पास बोलकर फिर कोशिश करें, या दवाएँ टाइप करें।",
                )
              : w}
          </Strip>
        ))}
        <View>
          {work.items.map((item) => (
            <View
              key={item.id}
              style={{
                paddingVertical: 14,
                gap: 8,
                borderBottomWidth: 1,
                borderColor: palette.rule,
              }}
            >
              <Row style={{ justifyContent: "space-between" }}>
                <Txt weight={600} size={17} style={{ flex: 1 }}>
                  {spokenItemTitle(item)}
                </Txt>
                {item.uncertain && (
                  <Badge warning>
                    {t("Check carefully", "ध्यान से जाँचें")}
                  </Badge>
                )}
              </Row>
              <Txt color={palette.ink2} size={14} num>
                {readableQuantity(item.quantity)} {w(readableUnit(item.unit))}
                {/* A form that only repeats the unit ("tablet · tablet") adds nothing. */}
                {item.form &&
                item.form.trim().toLowerCase() ===
                  readableUnit(item.unit).trim().toLowerCase()
                  ? ""
                  : ` · ${item.form || t("Check form", "रूप जाँचें")}`}
              </Txt>
              <Row style={{ justifyContent: "flex-start" }}>
                <Button
                  secondary
                  small
                  onPress={() =>
                    setEditingItemId(editingItemId === item.id ? null : item.id)
                  }
                >
                  {editingItemId === item.id
                    ? t("Done editing", "बदलाव हो गए")
                    : t("Edit details", "विवरण बदलें")}
                </Button>
              </Row>
              {editingItemId === item.id && (
                <View style={{ marginTop: 4 }}>
                  <Field
                    label={t("Medicine or brand", "दवा या ब्रांड")}
                    value={item.name}
                    onChange={(name) => patchItem(item.id, { name })}
                  />
                  <Row style={{ alignItems: "flex-start" }}>
                    <View style={{ flex: 1 }}>
                      <Field
                        label={t("Strength", "ताकत")}
                        value={item.strength ?? ""}
                        onChange={(strength) =>
                          patchItem(item.id, { strength: strength || null })
                        }
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field
                        label={t("Form", "रूप")}
                        value={item.form ?? ""}
                        onChange={(form) =>
                          patchItem(item.id, { form: form || null })
                        }
                      />
                    </View>
                  </Row>
                  <Row style={{ alignItems: "flex-start" }}>
                    <View style={{ flex: 1 }}>
                      <Field
                        label={t("Quantity", "मात्रा")}
                        value={item.quantity}
                        onChange={(quantity) =>
                          patchItem(item.id, { quantity })
                        }
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field
                        label={t("Spoken unit", "बोली गई इकाई")}
                        value={item.unit}
                        onChange={(unit) => patchItem(item.id, { unit })}
                      />
                    </View>
                  </Row>
                </View>
              )}
              <Txt color={palette.ink2} size={14} weight={500}>
                {t(
                  "Choose the actual supplied product",
                  "वास्तव में दी गई दवा चुनें",
                )}
              </Txt>
              <View>
                {voiceCandidates(Object.values(s.state!.products), item).map(
                  ({ product, strengthConflict, formConflict }) => (
                    <Pressable
                      key={product.id}
                      accessibilityRole="button"
                      onPress={() => onPick(item.id, product.id)}
                      style={({ pressed }) => ({
                        minHeight: 52,
                        paddingVertical: 10,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                        borderTopWidth: 1,
                        borderColor: palette.rule,
                        backgroundColor: pressed ? palette.desk : "transparent",
                      })}
                    >
                      <View style={{ flex: 1, gap: 2 }}>
                        <Txt weight={600}>
                          {product.name} {product.strength} · {product.form}
                        </Txt>
                        {(strengthConflict || formConflict) && (
                          <Txt size={13} weight={600} color={palette.declined}>
                            {t(
                              "Strength or form differs — verify before selecting",
                              "ताकत या रूप अलग है — चुनने से पहले जाँचें",
                            )}
                          </Txt>
                        )}
                      </View>
                      <Icon
                        name="chevron-forward"
                        size={18}
                        color={palette.ink3}
                      />
                    </Pressable>
                  ),
                )}
              </View>
              {!voiceCandidates(Object.values(s.state!.products), item)
                .length && (
                <Strip tone="waiting">
                  {t(
                    "No catalogue match. Correct the name or use product search; no substitute was selected.",
                    "कैटलॉग में मिलान नहीं। नाम सुधारें या सामान खोजें; दूसरी दवा नहीं चुनी गई।",
                  )}
                </Strip>
              )}
              <Row style={{ justifyContent: "flex-end", marginTop: 8 }}>
                <Button
                  variant="danger"
                  small
                  onPress={() =>
                    void change((v) => ({
                      ...v,
                      items: v.items.filter((i) => i.id !== item.id),
                    }))
                  }
                >
                  {t("Remove spoken item", "बोला सामान हटाएँ")}
                </Button>
              </Row>
            </View>
          ))}
        </View>
        {!work.items.length &&
          !work.jobId &&
          jobs
            .filter((j) => !work.appliedJobIds.includes(j.id))
            .slice(0, 3)
            .map((j) => (
              <Button
                key={j.id}
                secondary
                small
                onPress={() =>
                  void change((v) => ({ ...v, jobId: j.id, error: undefined }))
                }
              >
                {t("Resume voice draft", "आवाज़ ड्राफ्ट फिर खोलें")} ·{" "}
                {j.status} · {clock(j.created_at)}
              </Button>
            ))}
        <View style={{ marginTop: 16, alignItems: "flex-end", gap: 12 }}>
          <Button
            variant="quiet"
            small
            disabled={recording || busy || !!work.jobId}
            onPress={() => setDiscard(!discard)}
          >
            {t("Clear voice draft", "आवाज़ ड्राफ्ट साफ़ करें")}
          </Button>
          {discard && (
            <Button
              variant="danger"
              onPress={() => {
                void change((v) => ({
                  ...emptyVoice(uid()),
                  appliedJobIds: v.appliedJobIds,
                }));
                setDiscard(false);
                setAddingMore(false);
                setError("");
              }}
            >
              {t("Confirm clearing draft", "ड्राफ्ट साफ़ करने की पुष्टि करें")}
            </Button>
          )}
        </View>
      </View>
    </Sheet>
  );
}
