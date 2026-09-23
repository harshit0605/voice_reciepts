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
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";
import * as FileSystem from "expo-file-system";
import { useSession, uid } from "./session";
import { Txt, Button, Field, Row, Badge, Sheet, colors, styles } from "./ui";
import {
  applyVoiceResult,
  emptyVoice,
  parseExactSaleText,
  voiceCandidates,
  type VoiceWork,
  type SpokenItem,
} from "@counterwell/core";
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
    t = (en: string, hi: string) => (s.language === "hi" ? hi : en);
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
          setError((e as Error).message);
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
    else
      form.append("file", {
        uri: value.uri,
        name: "sale.m4a",
        type: "audio/mp4",
      } as any);
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
      if (state !== "active" && recordingRef.current) {
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
      if (!(await requestRecordingPermissionsAsync()).granted)
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
          <Badge>
            {t(
              "Draft only · confirm before billing",
              "केवल ड्राफ्ट · बिल से पहले पुष्टि करें",
            )}
          </Badge>
          <Txt muted size={11}>
            {work.items.length} {t("to review", "जाँच बाकी")}
          </Txt>
        </Row>
        {(!!error || !!work.error) && (
          <View
            accessibilityRole="alert"
            style={{
              backgroundColor: colors.amberBg,
              padding: 12,
              borderRadius: 8,
            }}
          >
            <Txt style={{ color: colors.red }}>{error || work.error}</Txt>
          </View>
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
              <View style={{ gap: 10 }}>
                <Txt bold>
                  {t("Recording", "रिकॉर्ड हो रहा है")} ·{" "}
                  {Math.floor(audio.durationMillis / 1000)} / 28 s
                </Txt>
                <Button onPress={() => void stop(true)}>
                  {t("Stop & prepare items", "रोकें और सामान तैयार करें")}
                </Button>
                <Button secondary onPress={() => void stop(false)}>
                  {t("Cancel recording", "रिकॉर्डिंग रद्द करें")}
                </Button>
              </View>
            ) : (
              <Button
                icon="mic-outline"
                disabled={busy || !!work.jobId || !!pendingAudio}
                onPress={() => void start()}
              >
                {t("Record sale items", "बिक्री का सामान बोलें")}
              </Button>
            )}
            {pendingAudio && !recording && (
              <View style={{ gap: 10 }}>
                <Txt muted>
                  {t(
                    "Upload did not finish. Retry before leaving this screen, or type the items below.",
                    "अपलोड पूरा नहीं हुआ। स्क्रीन छोड़ने से पहले फिर प्रयास करें या नीचे लिखें।",
                  )}
                </Txt>
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
                <Button secondary onPress={() => void clearAudio()}>
                  {t("Discard recording", "रिकॉर्डिंग हटाएँ")}
                </Button>
              </View>
            )}
            {!!work.jobId ? (
              <View style={{ gap: 8 }}>
                <ActivityIndicator color={colors.accent} />
                <Txt>
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
                <Txt muted size={11}>
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
          <View style={{ gap: 6 }}>
            <Txt bold size={12}>
              {t("Original text", "मूल पाठ")}
            </Txt>
            <Txt muted size={12}>
              {work.transcript}
            </Txt>
            <Txt muted size={11}>
              {work.source === "local"
                ? t(
                    "Processed locally · no API call",
                    "डिवाइस पर पढ़ा गया · कोई API कॉल नहीं",
                  )
                : work.source === "sample"
                  ? t("Synthetic sample", "नमूना डेटा")
                  : t(
                      "API draft · human confirmation required",
                      "API ड्राफ्ट · इंसानी पुष्टि ज़रूरी",
                    )}
            </Txt>
          </View>
        )}
        {work.warnings.map((w, i) => (
          <Txt key={i} size={12} style={{ color: colors.amber }}>
            {w}
          </Txt>
        ))}
        {work.items.map((item) => (
          <View key={item.id} style={styles.listRow}>
            <Row style={{ justifyContent: "space-between", marginBottom: 14 }}>
              <Txt bold size={17} style={{ flex: 1 }}>
                {item.name} {item.strength}
              </Txt>
              {item.uncertain && (
                <Badge warning>{t("Check carefully", "ध्यान से जाँचें")}</Badge>
              )}
            </Row>
            <Txt muted>
              {item.quantity} {item.unit} ·{" "}
              {item.form || t("Check form", "रूप जाँचें")}
            </Txt>
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
            {editingItemId === item.id && (
              <>
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
                      onChange={(quantity) => patchItem(item.id, { quantity })}
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
              </>
            )}
            <Txt muted size={12}>
              {t(
                "Choose the actual supplied product",
                "वास्तव में दी गई दवा चुनें",
              )}
            </Txt>
            {voiceCandidates(Object.values(s.state!.products), item).map(
              ({ product, strengthConflict, formConflict }) => (
                <Pressable
                  key={product.id}
                  accessibilityRole="button"
                  onPress={() => onPick(item.id, product.id)}
                  style={{
                    paddingVertical: 14,
                    borderBottomWidth: 1,
                    borderColor: colors.line,
                  }}
                >
                  <Txt bold>
                    {product.name} {product.strength} · {product.form}
                  </Txt>
                  {(strengthConflict || formConflict) && (
                    <Txt size={11} style={{ color: colors.red }}>
                      {t(
                        "Strength or form differs — verify before selecting",
                        "ताकत या रूप अलग है — चुनने से पहले जाँचें",
                      )}
                    </Txt>
                  )}
                </Pressable>
              ),
            )}
            {!voiceCandidates(Object.values(s.state!.products), item)
              .length && (
              <Txt style={{ marginVertical: 10, color: colors.amber }}>
                {t(
                  "No catalogue match. Correct the name or use product search; no substitute was selected.",
                  "कैटलॉग में मिलान नहीं। नाम सुधारें या सामान खोजें; दूसरी दवा नहीं चुनी गई।",
                )}
              </Txt>
            )}
            <Button
              secondary
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
          </View>
        ))}
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
                {j.status} · {new Date(j.created_at).toLocaleTimeString()}
              </Button>
            ))}
        <Button
          secondary
          small
          disabled={recording || busy || !!work.jobId}
          onPress={() => setDiscard(!discard)}
        >
          {t("Clear voice draft", "आवाज़ ड्राफ्ट साफ़ करें")}
        </Button>
        {discard && (
          <Button
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
    </Sheet>
  );
}
