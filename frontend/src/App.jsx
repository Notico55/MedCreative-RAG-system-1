import React, { useEffect, useRef, useState } from "react";
import logo from "./assets/logo.png";
import bgImage from "./assets/background.png";
import KidneyModel from "./CKDCalculatorWidget";
import "./App.css";

/* =========================================================
   MEDCREATIVE API CONFIGURATION & HARDENING LAYERS
   ========================================================= */

const PRIMARY_RAILWAY_BACKEND =
  "https://medcreative-rag-system-1-production.up.railway.app";

const FALLBACK_BACKEND_URLS = [
  PRIMARY_RAILWAY_BACKEND,
  // Backup / mirror endpoint layers for redundancy
];

const isBrowser = typeof window !== "undefined";
const isProduction = import.meta.env.PROD;

const cleanBaseUrl = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) return "";

  if (
    raw === "VITE_API_URL" ||
    raw === "VITE_BACKEND_URL" ||
    raw === "VITE_RAILWAY_URL" ||
    raw.includes("YOUR_RAILWAY") ||
    raw.includes("your-railway")
  ) {
    return "";
  }

  if (
    isProduction &&
    /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?/i.test(raw)
  ) {
    return "";
  }

  return raw
    .replace(/\/api\/chat\/?$/i, "")
    .replace(/\/chat\/?$/i, "")
    .replace(/\/+$/, "");
};

const envApiBase =
  cleanBaseUrl(import.meta.env.VITE_API_URL) ||
  cleanBaseUrl(import.meta.env.VITE_BACKEND_URL) ||
  cleanBaseUrl(import.meta.env.VITE_RAILWAY_URL);

const runtimeApiBase = isBrowser
  ? cleanBaseUrl(window.__MEDCREATIVE_API_URL__)
  : "";

const API_BASE_URL =
  runtimeApiBase ||
  envApiBase ||
  PRIMARY_RAILWAY_BACKEND;

// Multi-layered endpoint variations to eliminate 404/Routing errors
const generateEndpointVariations = (baseUrl) => [
  `${baseUrl}/chat`,
  `${baseUrl}/api/chat`,
];

const API_TIMEOUT_MS = 45000; // Extended timeout for Railway cold starts
const API_RETRIES = 3;

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableStatus = (status) =>
  status === 404 ||
  status === 405 ||
  status === 502 ||
  status === 503 ||
  status === 504;

/* =========================================================
   RESILIENT BACKEND REQUEST LAYER WITH MULTI-URL FALLBACKS
   ========================================================= */

const requestChat = async (payload) => {
  let lastError = null;

  // Build full queue of backup base URLs and endpoint permutations
  const candidateBaseUrls = Array.from(
    new Set([API_BASE_URL, ...FALLBACK_BACKEND_URLS])
  ).filter(Boolean);

  for (const currentBase of candidateBaseUrls) {
    const endpoints = generateEndpointVariations(currentBase);

    for (const endpoint of endpoints) {
      for (
        let attempt = 0;
        attempt <= API_RETRIES;
        attempt += 1
      ) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
        }, API_TIMEOUT_MS);

        try {
          console.log(
            `[MedCreative] Request attempt ${attempt + 1} targeting: ${endpoint}`
          );

          const response = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
            cache: "no-store",
          });

          clearTimeout(timeoutId);

          if (response.ok) {
            let data;
            try {
              data = await response.json();
            } catch {
              throw new Error(
                "Backend returned a non-JSON response format."
              );
            }

            if (!data || typeof data !== "object") {
              throw new Error(
                "Backend returned an invalid data payload structure."
              );
            }

            return data;
          }

          let backendMessage = "";
          try {
            const errorData = await response.json();
            backendMessage =
              errorData?.detail ||
              errorData?.message ||
              errorData?.error ||
              "";
          } catch {
            // Fallback if error body is plain text or empty
          }

          lastError = new Error(
            typeof backendMessage === "string" && backendMessage.trim()
              ? backendMessage
              : `Backend responded with HTTP error status: ${response.status}`
          );

          if (isRetryableStatus(response.status)) {
            // Try next endpoint/retry layer immediately
            break;
          }

          throw lastError;
        } catch (error) {
          clearTimeout(timeoutId);
          lastError = error;

          const message = String(
            error?.message || ""
          ).toLowerCase();
          const isAbort = error?.name === "AbortError";
          const isNetworkError =
            message.includes("failed to fetch") ||
            message.includes("networkerror") ||
            message.includes("network error") ||
            message.includes("fetch");

          if (isAbort || isNetworkError) {
            if (attempt < API_RETRIES) {
              await sleep(1000 * (attempt + 1));
              continue;
            }
            break;
          }

          // Non-network errors break current endpoint loop to check backup URLs
          break;
        }
      }
    }
  }

  throw (
    lastError ||
    new Error(
      "Unable to reach the MedCreative backend services across all fallback routes."
    )
  );
};

/* =========================================================
   HELPERS & FORMATTERS
   ========================================================= */

const detectLanguage = (text = "") => {
  const arabic = text.match(/[\u0600-\u06FF]/g) || [];
  const english = text.match(/[A-Za-z]/g) || [];
  return arabic.length > 0 && arabic.length >= english.length
    ? "ar"
    : "en";
};

const cleanMarkdown = (text = "") =>
  String(text)
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/^#+\s?/gm, "")
    .replace(/^[-*]\s?/gm, "")
    .trim();

const formatAnswer = (text = "") => {
  if (!text) return null;
  const cleanedText = String(text).trim();

  if (
    cleanedText.length < 150 ||
    cleanedText.startsWith("⚠️") ||
    cleanedText.startsWith("البيانات")
  ) {
    return <span>{cleanMarkdown(cleanedText)}</span>;
  }

  const rawLines = cleanedText.split(/\n+/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed) return [];
    if (trimmed.length > 120) {
      return trimmed.split(/(?<=[.?!])\s+/);
    }
    return [trimmed];
  });

  const parsedItems = rawLines.map((line) => line.trim()).filter(Boolean);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        marginTop: "4px",
      }}
    >
      {parsedItems.map((item, index) => {
        const cleanedItem = item
          .replace(/^[-*•]\s*/, "")
          .replace(/^\d+\.\s*/, "");
        const parts = cleanedItem.split(/(\*\*.*?\*\*)/g);

        return (
          <div
            key={index}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "10px",
              padding: "8px 12px",
              borderRadius: "8px",
              backgroundColor: "rgba(0, 0, 0, 0.03)",
              borderLeft: "3px solid #0284c7",
              fontSize: "0.95rem",
              lineHeight: "1.5",
            }}
          >
            <span
              style={{
                color: "#0284c7",
                fontWeight: "bold",
                marginTop: "1px",
              }}
            >
              •
            </span>
            <div style={{ flex: 1 }}>
              {parts.map((part, partIndex) =>
                part.startsWith("**") && part.endsWith("**") ? (
                  <strong
                    key={partIndex}
                    style={{ color: "#0284c7" }}
                  >
                    {part.slice(2, -2)}
                  </strong>
                ) : (
                  part
                )
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/* =========================================================
   MAIN APP COMPONENT
   ========================================================= */

export default function App() {
  const [messages, setMessages] = useState([
    {
      sender: "bot",
      text: "Hello! I'm MedCreative, your clinical assistant ready to help with CKD and KDIGO guidelines. How may I help you today? 😊",
      originalText:
        "Hello! I'm MedCreative, your clinical assistant ready to help with CKD and KDIGO guidelines. How may I help you today? 😊",
      userPromptText: "",
      sources: [],
      isConversational: true,
      evaluationMetrics: {
        faithfulness_score: 1,
        answer_relevance_score: 1,
        context_relevance_score: 1,
        hallucination_risk: "None (Conversational)",
      },
      warningMessage: null,
      currentLanguage: "en",
      cachedTranslation: null,
      translating: false,
      copied: false,
    },
  ]);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [retrievalK, setRetrievalK] = useState(5);
  const [scoreThreshold, setScoreThreshold] = useState(1.2);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  
  // Retractable Right-Side Panel State (Closed by default on app load)[cite: 2]
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false);

  const [isPresetMenuOpen, setIsPresetMenuOpen] = useState(false);
  const [presetTab, setPresetTab] = useState("questions");
  const [isListening, setIsListening] = useState(false);
  const [speakingIndex, setSpeakingIndex] = useState(null);
  const [isSymptomsModalOpen, setIsSymptomsModalOpen] = useState(false);
  const [symptomsTab, setSymptomsTab] = useState("overview");
  const [selectedSymptoms, setSelectedSymptoms] = useState([]);
  const [evalAge, setEvalAge] = useState(45);
  const [evalCreatinine, setEvalCreatinine] = useState(1.1);
  const [evalUrea, setEvalUrea] = useState(30);
  const [evaluationResult, setEvaluationResult] = useState(null);

  const latestMessageRef = useRef(null);
  const recognitionRef = useRef(null);
  const inputValRef = useRef("");
  const loadingRef = useRef(false);
  const retrievalKRef = useRef(retrievalK);
  const scoreThresholdRef = useRef(scoreThreshold);
  const voiceSubmissionRef = useRef(false);
  const handleSubmitRef = useRef(null);

  useEffect(() => {
    inputValRef.current = input;
  }, [input]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    retrievalKRef.current = retrievalK;
  }, [retrievalK]);

  useEffect(() => {
    scoreThresholdRef.current = scoreThreshold;
  }, [scoreThreshold]);

  useEffect(() => {
    console.log("----------------------------------------");
    console.log("[MedCreative Frontend Origin]:", window.location.origin);
    console.log("[MedCreative Active Backend URL]:", API_BASE_URL);
    console.log("----------------------------------------");
  }, []);

  useEffect(() => {
    latestMessageRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [messages.length, loading]);

  /* Speech Recognition Setup */
  useEffect(() => {
    if (!isBrowser) return;
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "ar-EG";

    recognition.onstart = () => {
      setIsListening(true);
      voiceSubmissionRef.current = false;
    };

    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }
      const finalText = transcript.trim();
      if (finalText) {
        inputValRef.current = finalText;
        setInput(finalText);
      }
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition error:", event.error);
      setIsListening(false);
      voiceSubmissionRef.current = false;
    };

    recognition.onend = () => {
      setIsListening(false);
      const spokenText = inputValRef.current.trim();
      if (
        spokenText &&
        !loadingRef.current &&
        !voiceSubmissionRef.current
      ) {
        voiceSubmissionRef.current = true;
        setTimeout(() => {
          handleSubmitRef.current?.(null, spokenText);
          setTimeout(() => {
            voiceSubmissionRef.current = false;
          }, 500);
        }, 300);
      }
    };

    recognitionRef.current = recognition;
    return () => {
      try {
        recognition.stop();
      } catch {
        /* cleanup */
      }
      recognitionRef.current = null;
    };
  }, []);

  const toggleVoiceInput = async () => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }
    if (isListening) {
      try {
        recognitionRef.current?.stop();
      } catch {
        /* ignore */
      }
      setIsListening(false);
      return;
    }
    if (loading) return;

    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        stream.getTracks().forEach((track) => track.stop());
      }
      inputValRef.current = input;
      recognitionRef.current?.start();
    } catch (error) {
      console.error("Microphone access error:", error);
      setIsListening(false);
      alert(
        "Could not access the microphone. Please check permission settings."
      );
    }
  };

  const copyResponseText = async (text, index) => {
    try {
      await navigator.clipboard.writeText(cleanMarkdown(text));
      setMessages((previous) =>
        previous.map((message, messageIndex) =>
          messageIndex === index ? { ...message, copied: true } : message
        )
      );
      setTimeout(() => {
        setMessages((previous) =>
          previous.map((message, messageIndex) =>
            messageIndex === index ? { ...message, copied: false } : message
          )
        );
      }, 2000);
    } catch (error) {
      console.error("Copy failed:", error);
    }
  };

  const speakAnswer = (text, index) => {
    if (!("speechSynthesis" in window)) {
      alert("Text-to-speech is not supported in this browser.");
      return;
    }
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      setSpeakingIndex(null);
      return;
    }

    const message = messages[index];
    const utterance = new SpeechSynthesisUtterance(cleanMarkdown(text));
    utterance.lang = message?.currentLanguage === "ar" ? "ar-EG" : "en-US";
    utterance.rate = 1;
    utterance.onstart = () => setSpeakingIndex(index);
    utterance.onend = () => setSpeakingIndex(null);
    utterance.onerror = () => setSpeakingIndex(null);
    window.speechSynthesis.speak(utterance);
  };

  const translateMessage = async (index) => {
    const message = messages[index];
    if (!message) return;

    if (message.cachedTranslation) {
      const originalLanguage = detectLanguage(message.originalText || "");
      const isCurrentlyOriginal = message.currentLanguage === originalLanguage;
      setMessages((previous) =>
        previous.map((item, itemIndex) => {
          if (itemIndex !== index) return item;
          return {
            ...item,
            text: isCurrentlyOriginal
              ? item.cachedTranslation
              : item.originalText,
            currentLanguage: isCurrentlyOriginal
              ? originalLanguage === "ar"
                ? "en"
                : "ar"
              : originalLanguage,
          };
        })
      );
      return;
    }

    setMessages((previous) =>
      previous.map((item, itemIndex) =>
        itemIndex === index ? { ...item, translating: true } : item
      )
    );

    try {
      const sourceLanguage = message.currentLanguage || detectLanguage(message.text);
      const targetLanguage = sourceLanguage === "ar" ? "en" : "ar";
      const textToTranslate = message.originalText || message.text;
      const maxChunkLength = 450;
      const translatedChunks = [];

      for (let i = 0; i < textToTranslate.length; i += maxChunkLength) {
        const chunk = textToTranslate.substring(i, i + maxChunkLength);
        const response = await fetch(
          `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
            chunk
          )}&langpair=${sourceLanguage}|${targetLanguage}`
        );
        if (!response.ok) throw new Error("Translation service failed.");
        const data = await response.json();
        translatedChunks.push(
          data?.responseData?.translatedText || chunk
        );
      }

      const translated = translatedChunks.join(" ");
      setMessages((previous) =>
        previous.map((item, itemIndex) =>
          itemIndex === index
            ? {
                ...item,
                originalText: message.originalText || message.text,
                cachedTranslation: translated,
                text: translated,
                currentLanguage: targetLanguage,
                translating: false,
              }
            : item
        )
      );
    } catch (error) {
      console.error("Translation error:", error);
      setMessages((previous) =>
        previous.map((item, itemIndex) =>
          itemIndex === index ? { ...item, translating: false } : item
        )
      );
      alert("Translation failed or service limits exceeded.");
    }
  };

  const handleSubmit = async (event, customPrompt = null) => {
    if (event) event.preventDefault();
    const rawInput = (customPrompt !== null ? customPrompt : input).trim();
    if (!rawInput || loadingRef.current) return;

    const language = detectLanguage(rawInput);
    if (customPrompt === null) {
      setInput("");
      inputValRef.current = "";
    }
    setIsPresetMenuOpen(false);

    setMessages((previous) => [
      ...previous,
      {
        sender: "user",
        text: rawInput,
        currentLanguage: language,
      },
    ]);

    setLoading(true);
    loadingRef.current = true;

    try {
      const data = await requestChat({
        question: rawInput,
        top_k: retrievalKRef.current,
        distance_threshold: scoreThresholdRef.current,
      });

      const finalAnswer =
        data?.answer ||
        data?.response ||
        data?.message ||
        "No answer was returned by the backend.";

      let evalMetrics = data?.evaluation_metrics || data?.metrics || null;
      if (evalMetrics) {
        const contextRelevance = Number(evalMetrics.context_relevance_score ?? 1);
        const faithfulness = Number(evalMetrics.faithfulness_score ?? 1);
        if (contextRelevance < 0.3 || faithfulness < 0.8) {
          evalMetrics = {
            ...evalMetrics,
            hallucination_risk: "High (Low Context/Faithfulness)",
          };
        }
      }

      const sources = Array.isArray(data?.sources) ? data.sources : [];

      setMessages((previous) => [
        ...previous,
        {
          sender: "bot",
          text: finalAnswer,
          originalText: finalAnswer,
          userPromptText: rawInput,
          sources,
          isConversational: Boolean(data?.is_conversational),
          evaluationMetrics: evalMetrics,
          warningMessage: data?.warning_message || data?.warning || null,
          currentLanguage: data?.language || language,
          cachedTranslation: null,
          translating: false,
          copied: false,
        },
      ]);
    } catch (error) {
      console.error("[MedCreative] Backend request failed completely:", error);
      
      const errorMessage =
        typeof error === "string"
          ? error
          : error?.message || String(error || "Unknown error occurred");

      setMessages((previous) => [
        ...previous,
        {
          sender: "bot",
          text:
            `⚠️ Connection Error: ${errorMessage}\n\n` +
            `The frontend is running on Vercel and attempting to reach Railway. Target Backend URL: ${PRIMARY_RAILWAY_BACKEND}`,
          originalText: `⚠️ Connection Error: ${errorMessage}`,
          userPromptText: "",
          sources: [],
          isConversational: false,
          evaluationMetrics: null,
          warningMessage: null,
          currentLanguage: "en",
          cachedTranslation: null,
          translating: false,
          copied: false,
        },
      ]);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  };

  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  });

  const handleSymptomToggle = (symptom) => {
    setSelectedSymptoms((previous) =>
      previous.includes(symptom)
        ? previous.filter((item) => item !== symptom)
        : [...previous, symptom]
    );
  };

  const calculateCKDRisk = () => {
    const creatinine = Number(evalCreatinine);
    const urea = Number(evalUrea);
    const age = Number(evalAge);
    const symptomCount = selectedSymptoms.length;

    let riskLevel = "Low Risk";
    let stage = "No clear high-risk pattern detected.";
    let color = "#10b981";

    if (creatinine > 2.5 || urea > 60 || symptomCount >= 4) {
      riskLevel = "High Risk";
      stage = "Needs clinical evaluation / possible advanced CKD.";
      color = "#ef4444";
    } else if (creatinine > 1.5 || urea > 45 || symptomCount >= 2) {
      riskLevel = "Moderate Risk";
      stage = "Further kidney-function assessment is recommended.";
      color = "#f59e0b";
    } else if (creatinine > 1.2 || urea > 35 || symptomCount >= 1 || age > 60) {
      riskLevel = "Mild Risk";
      stage = "Consider further kidney-function assessment.";
      color = "#3b82f6";
    }

    setEvaluationResult({ riskLevel, stage, color, symptomCount });
  };

  const symptoms = [
    "Fatigue / Low Energy",
    "Swelling in Ankles/Feet",
    "Foamy Urine",
    "Shortness of Breath",
    "Itchy / Dry Skin",
    "High Blood Pressure",
    "Nausea or Loss of Appetite",
    "Muscle Cramps at Night",
    "Frequent Night Urination (Nocturia)",
    "Puffy Eyes in the Morning",
  ];

  const clinicalPresets = [
    { q: "What is the normal GFR?", label: "What is the normal GFR?", emoji: "💧" },
    { q: "What are the KDIGO staging criteria for CKD based on GFR and Albuminuria?", label: "CKD Staging Criteria", emoji: "📊" },
    { q: "ايه هو الفشل الكلوي؟", label: "ما هو الفشل الكلوي؟", emoji: "🩺" },
    { q: "What are the guidelines for blood pressure management in CKD patients?", label: "Blood Pressure Targets", emoji: "❤️" },
    { q: "What is albuminuria?", label: "What is albuminuria?", emoji: "🧪" },
    { q: "How does water intake affect kidneys?", label: "Water & Kidney Health", emoji: "🌊" },
    { q: "What is a normal creatinine level?", label: "Normal Creatinine", emoji: "📈" },
    { q: "When should a CKD patient be referred to a nephrologist?", label: "Nephrology Referral", emoji: "🏥" },
    { q: "How do SGLT2 inhibitors protect the kidneys in diabetic kidney disease?", label: "SGLT2 Kidney Protection", emoji: "🛡️" },
  ];

  const causePresets = [
    { q: "What are the primary causes of chronic kidney disease (CKD)?", label: "Primary Causes of CKD", emoji: "🧬" },
    { q: "What causes acute kidney injury (AKI)?", label: "Acute Kidney Injury Causes", emoji: "⚡" },
    { q: "What causes diabetic nephropathy?", label: "Diabetic Nephropathy Etiology", emoji: "🩸" },
    { q: "What causes hypertensive nephrosclerosis?", label: "Hypertensive Nephrosclerosis", emoji: "❤️" },
  ];

  return (
    <div
      className={`page-wrapper ${isDarkMode ? "dark-theme" : "light-theme"}`}
      style={{
        display: "flex",
        flexDirection: "row",
        width: "100vw",
        height: "100vh",
        maxHeight: "100vh",
        overflow: "hidden",
        boxSizing: "border-box",
        position: "fixed",
        top: 0,
        left: 0,
      }}
    >
      {/* Left Sidebar Toggle Button */}
      <button
        onClick={() => setIsSidebarOpen((previous) => !previous)}
        title={isSidebarOpen ? "Collapse Sidebar" : "Open Sidebar"}
        style={{
          position: "fixed",
          top: "20px",
          left: isSidebarOpen ? "340px" : "20px",
          zIndex: 1000000,
          background: "linear-gradient(135deg, #0284c7, #0369a1)",
          border: "none",
          color: "#fff",
          padding: "10px 14px",
          borderRadius: "10px",
          cursor: "pointer",
          fontWeight: "700",
          boxShadow: "0 4px 15px rgba(0,0,0,0.2)",
          transition: "left 0.3s ease",
        }}
      >
        {isSidebarOpen ? "◀ Hide Sidebar" : "▶ Open Sidebar"}
      </button>

      {/* Right Side Panel Toggle Button (Risk & Safety Tab Drawer) */}
      <button
        onClick={() => setIsRightPanelOpen((previous) => !previous)}
        title={isRightPanelOpen ? "Collapse Risk & Safety Panel" : "Open Risk & Safety Panel"}
        style={{
          position: "fixed",
          top: "20px",
          right: isRightPanelOpen ? "340px" : "20px",
          zIndex: 1000000,
          background: "linear-gradient(135deg, #059669, #047857)",
          border: "none",
          color: "#fff",
          padding: "10px 14px",
          borderRadius: "10px",
          cursor: "pointer",
          fontWeight: "700",
          boxShadow: "0 4px 15px rgba(0,0,0,0.2)",
          transition: "right 0.3s ease",
        }}
      >
        {isRightPanelOpen ? "🛡️ Hide Safety ▶" : "🛡️ Risk & Safety ◀"}
      </button>

      {/* Quick Presets Menu Button */}
      <div style={{ position: "fixed", top: "20px", right: isRightPanelOpen ? "360px" : "90px", zIndex: 999999, transition: "right 0.3s ease" }}>
        <button
          onClick={() => setIsPresetMenuOpen((previous) => !previous)}
          title="Quick Clinical Presets & Guidelines"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "10px 18px",
            background: "linear-gradient(135deg, #e4e0d8, #c8beaf)",
            border: "1px solid #b3a896",
            borderRadius: "30px",
            cursor: "pointer",
            color: "#2c2825",
            fontWeight: "700",
            boxShadow: "0 8px 25px rgba(0,0,0,0.15)",
          }}
        >
          <span style={{ fontSize: "1.2rem" }}>💊</span>
          <span>Quick Presets</span>
        </button>

        {isPresetMenuOpen && (
          <div
            style={{
              position: "absolute",
              right: 0,
              top: "55px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              background: isDarkMode ? "#1e293b" : "#ffffff",
              border: isDarkMode ? "1px solid #475569" : "1px solid #cbd5e1",
              borderRadius: "12px",
              padding: "14px",
              width: "360px",
              maxWidth: "calc(100vw - 40px)",
              boxShadow: "0 15px 35px rgba(0,0,0,0.3)",
              zIndex: 9999999,
            }}
          >
            <div style={{ display: "flex", gap: "6px", marginBottom: "6px" }}>
              <button
                onClick={() => setPresetTab("questions")}
                style={{
                  flex: 1,
                  padding: "8px",
                  borderRadius: "8px",
                  border: "none",
                  background:
                    presetTab === "questions"
                      ? "linear-gradient(135deg, #0284c7, #0369a1)"
                      : isDarkMode
                      ? "#0f172a"
                      : "#f1f5f9",
                  color: presetTab === "questions" ? "#fff" : "inherit",
                  fontWeight: "700",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                }}
              >
                💊 Clinical Questions
              </button>
              <button
                onClick={() => setPresetTab("causes")}
                style={{
                  flex: 1,
                  padding: "8px",
                  borderRadius: "8px",
                  border: "none",
                  background:
                    presetTab === "causes"
                      ? "linear-gradient(135deg, #059669, #047857)"
                      : isDarkMode
                      ? "#0f172a"
                      : "#f1f5f9",
                  color: presetTab === "causes" ? "#fff" : "inherit",
                  fontWeight: "700",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                }}
              >
                🧬 Causes
              </button>
            </div>

            {presetTab === "questions" && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  maxHeight: "380px",
                  overflowY: "auto",
                }}
              >
                {clinicalPresets.map((preset, index) => (
                  <button
                    key={index}
                    onClick={() => handleSubmit(null, preset.q)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      textAlign: "left",
                      width: "100%",
                      padding: "10px 12px",
                      background: isDarkMode ? "#253244" : "#eef3f8",
                      border: isDarkMode ? "1px solid #37475e" : "1px solid #d8e2ed",
                      borderRadius: "10px",
                      cursor: "pointer",
                      color: isDarkMode ? "#f8fafc" : "#1e293b",
                      fontWeight: "500",
                      fontSize: "0.9rem",
                    }}
                  >
                    <span>{preset.emoji}</span>
                    <span>{preset.label}</span>
                  </button>
                ))}
              </div>
            )}

            {presetTab === "causes" && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  maxHeight: "380px",
                  overflowY: "auto",
                }}
              >
                <p style={{ fontSize: "0.8rem", margin: "0 0 4px 0", opacity: 0.8 }}>
                  Explore primary disease causes and etiologies:
                </p>
                {causePresets.map((preset, index) => (
                  <button
                    key={index}
                    onClick={() => handleSubmit(null, preset.q)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      textAlign: "left",
                      width: "100%",
                      padding: "10px 12px",
                      background: isDarkMode ? "#16332c" : "#e6f4ed",
                      border: isDarkMode ? "1px solid #224d42" : "1px solid #cce8d9",
                      borderRadius: "10px",
                      cursor: "pointer",
                      color: isDarkMode ? "#f8fafc" : "#1e293b",
                      fontWeight: "500",
                      fontSize: "0.9rem",
                    }}
                  >
                    <span>{preset.emoji}</span>
                    <span>{preset.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Symptoms and Risk Screening Modal */}
      {isSymptomsModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(0,0,0,0.7)",
            zIndex: 99999999,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: "20px",
          }}
        >
          <div
            style={{
              backgroundColor: isDarkMode ? "#1e293b" : "#ffffff",
              color: isDarkMode ? "#f8fafc" : "#0f172a",
              borderRadius: "16px",
              width: "100%",
              maxWidth: "680px",
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 20px 40px rgba(0,0,0,0.4)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "16px 20px",
                borderBottom: "1px solid rgba(150,150,150,0.2)",
              }}
            >
              <h3 style={{ margin: 0, fontSize: "1.2rem" }}>
                ❤️ CKD Symptoms & Risk Assessment
              </h3>
              <button
                onClick={() => setIsSymptomsModalOpen(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  fontSize: "1.2rem",
                  cursor: "pointer",
                  color: "inherit",
                  fontWeight: "bold",
                }}
              >
                ✕
              </button>
            </div>

            <div
              style={{
                display: "flex",
                gap: "4px",
                padding: "8px 12px 0",
                background: isDarkMode ? "#0f172a" : "#f8fafc",
              }}
            >
              <button
                onClick={() => setSymptomsTab("overview")}
                style={{
                  flex: 1,
                  padding: "10px",
                  borderRadius: "8px 8px 0 0",
                  border: "none",
                  background:
                    symptomsTab === "overview"
                      ? "linear-gradient(135deg, #0284c7, #0369a1)"
                      : isDarkMode
                      ? "#1e293b"
                      : "#e2e8f0",
                  color: symptomsTab === "overview" ? "#fff" : "inherit",
                  fontWeight: "700",
                  cursor: "pointer",
                }}
              >
                📋 Symptoms Overview
              </button>
              <button
                onClick={() => setSymptomsTab("evaluator")}
                style={{
                  flex: 1,
                  padding: "10px",
                  borderRadius: "8px 8px 0 0",
                  border: "none",
                  background:
                    symptomsTab === "evaluator"
                      ? "linear-gradient(135deg, #059669, #047857)"
                      : isDarkMode
                      ? "#1e293b"
                      : "#e2e8f0",
                  color: symptomsTab === "evaluator" ? "#fff" : "inherit",
                  fontWeight: "700",
                  cursor: "pointer",
                }}
              >
                🧪 Risk Screening
              </button>
            </div>

            <div style={{ padding: "20px" }}>
              {symptomsTab === "overview" && (
                <div>
                  <div
                    style={{
                      backgroundColor: isDarkMode ? "#0f172a" : "#f1f5f9",
                      borderRadius: "14px",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        background: "linear-gradient(135deg, #0284c7, #0369a1)",
                        color: "#fff",
                        padding: "14px 18px",
                        fontWeight: "700",
                      }}
                    >
                      ❤️ Common Renal Manifestations
                    </div>
                    <div
                      style={{
                        padding: "16px",
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: "12px",
                        fontSize: "0.85rem",
                      }}
                    >
                      <div style={{ background: isDarkMode ? "#1e293b" : "#ffffff", padding: "12px", borderRadius: "10px" }}>
                        <strong>💧 Fluid & Urinary</strong>
                        <p>Foamy urine, swelling, and changes in urine output.</p>
                      </div>
                      <div style={{ background: isDarkMode ? "#1e293b" : "#ffffff", padding: "12px", borderRadius: "10px" }}>
                        <strong>⚡ Metabolic & Energy</strong>
                        <p>Fatigue, weakness, and muscle cramps.</p>
                      </div>
                      <div style={{ background: isDarkMode ? "#1e293b" : "#ffffff", padding: "12px", borderRadius: "10px" }}>
                        <strong>🩸 Cardiovascular</strong>
                        <p>Hypertension and possible shortness of breath.</p>
                      </div>
                      <div style={{ background: isDarkMode ? "#1e293b" : "#ffffff", padding: "12px", borderRadius: "10px" }}>
                        <strong>🧬 Dermatologic & GI</strong>
                        <p>Dry/itchy skin, nausea, and appetite changes.</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {symptomsTab === "evaluator" && (
                <div>
                  <p style={{ fontSize: "0.9rem", opacity: 0.9 }}>
                    Select symptoms and enter basic laboratory information for a simple screening estimate.
                  </p>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "8px",
                      marginBottom: "20px",
                    }}
                  >
                    {symptoms.map((symptom, index) => {
                      const selected = selectedSymptoms.includes(symptom);
                      return (
                        <div
                          key={index}
                          onClick={() => handleSymptomToggle(symptom)}
                          style={{
                            padding: "8px 12px",
                            borderRadius: "8px",
                            border: selected ? "1px solid #059669" : "1px solid rgba(150,150,150,0.3)",
                            backgroundColor: selected
                              ? isDarkMode
                                ? "#064e3b"
                                : "#d1fae5"
                              : isDarkMode
                              ? "#0f172a"
                              : "#f8fafc",
                            cursor: "pointer",
                            fontSize: "0.85rem",
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                          }}
                        >
                          <span>{selected ? "💊" : "🔹"}</span>
                          <span>{symptom}</span>
                        </div>
                      );
                    })}
                  </div>

                  <div
                    style={{
                      backgroundColor: isDarkMode ? "#0f172a" : "#f8fafc",
                      padding: "15px",
                      borderRadius: "10px",
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr",
                      gap: "10px",
                    }}
                  >
                    <div>
                      <label>Age</label>
                      <input
                        type="number"
                        min="0"
                        value={evalAge}
                        onChange={(e) => setEvalAge(e.target.value)}
                        style={{ width: "100%", padding: "6px", boxSizing: "border-box" }}
                      />
                    </div>
                    <div>
                      <label>Creatinine</label>
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={evalCreatinine}
                        onChange={(e) => setEvalCreatinine(e.target.value)}
                        style={{ width: "100%", padding: "6px", boxSizing: "border-box" }}
                      />
                    </div>
                    <div>
                      <label>Urea</label>
                      <input
                        type="number"
                        min="0"
                        value={evalUrea}
                        onChange={(e) => setEvalUrea(e.target.value)}
                        style={{ width: "100%", padding: "6px", boxSizing: "border-box" }}
                      />
                    </div>
                  </div>

                  <button
                    onClick={calculateCKDRisk}
                    style={{
                      width: "100%",
                      marginTop: "15px",
                      padding: "10px",
                      backgroundColor: "#059669",
                      color: "#fff",
                      border: "none",
                      borderRadius: "8px",
                      fontWeight: "bold",
                      cursor: "pointer",
                    }}
                  >
                    Run Screening Assessment 🚀
                  </button>

                  {evaluationResult && (
                    <div
                      style={{
                        marginTop: "15px",
                        padding: "12px",
                        borderRadius: "8px",
                        borderLeft: `5px solid ${evaluationResult.color}`,
                        backgroundColor: isDarkMode ? "#0f172a" : "#f1f5f9",
                      }}
                    >
                      <h4 style={{ color: evaluationResult.color, margin: "0 0 5px 0" }}>
                        {evaluationResult.riskLevel}
                      </h4>
                      <p>
                        <strong>Screening result:</strong> {evaluationResult.stage}
                      </p>
                      <small style={{ opacity: 0.75 }}>
                        This is a screening estimate, not a clinical diagnosis.
                      </small>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Left Sidebar Component */}
      <aside
        className="sidebar"
        style={{
          width: "320px",
          minWidth: "320px",
          maxWidth: "320px",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          flexShrink: 0,
          boxSizing: "border-box",
          overflowY: "auto",
          zIndex: 10,
          transform: isSidebarOpen ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.3s ease",
          position: isSidebarOpen ? "relative" : "absolute",
        }}
      >
        <div>
          <div className="sidebar-header" style={{ marginTop: "10px" }}>
            <div className="sidebar-brand">
              <h2>🥼🩺 MedCreative</h2>
              <span>CLINICAL RAG ASSISTANT</span>
            </div>
            <img src={logo} alt="MedCreative Logo" className="sidebar-logo" />
          </div>

          <div style={{ padding: "0 10px", marginBottom: "15px" }}>
            <button
              onClick={() => setIsSymptomsModalOpen(true)}
              style={{
                width: "100%",
                padding: "12px 16px",
                borderRadius: "12px",
                border: "1px solid #cbd5e1",
                backgroundColor: isDarkMode ? "#1e293b" : "#ffffff",
                color: isDarkMode ? "#f8fafc" : "#0f172a",
                fontWeight: "700",
                cursor: "pointer",
              }}
            >
              ❤️ 🩺 Symptoms & Risk Menu
            </button>
          </div>

          <div className="control-section">
            <h3>3D Interactive Model</h3>
            <KidneyModel />
          </div>
        </div>

        <div className="sidebar-footer" style={{ paddingBottom: "20px" }}>
          <button
            type="button"
            className="theme-toggle-modern-btn"
            onClick={() => setIsDarkMode((previous) => !previous)}
            style={{
              width: "100%",
              padding: "12px 16px",
              borderRadius: "10px",
              border: "1px solid rgba(150,150,150,0.3)",
              backgroundColor: isDarkMode ? "#ffffff" : "#1e293b",
              color: isDarkMode ? "#0f172a" : "#ffffff",
              fontWeight: "700",
              cursor: "pointer",
              marginBottom: "15px",
            }}
          >
            {isDarkMode ? "☀️ Switch to Light Mode" : "🌙 Switch to Dark Mode"}
          </button>

          <div
            className="control-section"
            style={{
              marginTop: "10px",
              borderTop: "1px solid rgba(150,150,150,0.2)",
              paddingTop: "12px",
            }}
          >
            <h3 style={{ fontSize: "0.9rem" }}>Parameters</h3>
            <div className="control-group" style={{ marginBottom: "8px" }}>
              <label>Retrieval K: {retrievalK}</label>
              <input
                type="range"
                min="1"
                max="10"
                value={retrievalK}
                onChange={(e) => setRetrievalK(Number(e.target.value))}
                style={{ width: "100%" }}
              />
            </div>
            <div className="control-group">
              <label>Distance Threshold: {scoreThreshold}</label>
              <input
                type="range"
                min="0.1"
                max="2.0"
                step="0.05"
                value={scoreThreshold}
                onChange={(e) => setScoreThreshold(Number(e.target.value))}
                style={{ width: "100%" }}
              />
            </div>
          </div>
        </div>
      </aside>

      {/* Main Chat Area */}
      <main
        className="app-container"
        style={{
          backgroundImage: `url(${bgImage})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          position: "relative",
          display: "flex",
          flexDirection: "column",
          flex: 1,
          height: "100%",
          overflow: "hidden",
          boxSizing: "border-box",
        }}
      >
        <div className="dashboard-header" style={{ flexShrink: 0, padding: "15px 20px" }}>
          <h1
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              justifyContent: "center",
              margin: 0,
              fontSize: "1.5rem",
            }}
          >
            ❤️ 🥼🩺 Chronic Kidney Disease (CKD) - RAG
          </h1>
          <p
            className="subtitle"
            style={{
              margin: "4px 0 0 0",
              textAlign: "center",
              fontSize: "0.85rem",
            }}
          >
            Clinical Question → Answer → Evidence → Recommendations → Risk/Safety Report 👨‍⚕️
          </p>
        </div>

        <div
          className="chat-box"
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "0 20px 100px 20px",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {messages.map((message, index) => {
            const isBot = message.sender === "bot";
            const metrics = message.evaluationMetrics;
            const contextRel = Number(metrics?.context_relevance_score ?? 1);
            const faith = Number(metrics?.faithfulness_score ?? 1);
            const highRisk =
              metrics &&
              (contextRel < 0.3 ||
                faith < 0.8 ||
                String(metrics.hallucination_risk || "").toLowerCase().includes("high"));
            const isSmallOutput = message.text && message.text.length < 80;

            return (
              <div
                key={index}
                ref={index === messages.length - 1 ? latestMessageRef : null}
                className={`message-row ${isBot ? "bot-row" : "user-row"}`}
              >
                <div className={`message-bubble ${isBot ? "bot-bubble" : "user-bubble"}`}>
                  {isBot ? (
                    <div className="bot-bubble-content-wrapper">
                      {message.warningMessage && (
                        <div
                          style={{
                            backgroundColor: "#fff3cd",
                            color: "#856404",
                            padding: "10px 14px",
                            borderRadius: "6px",
                            marginBottom: "12px",
                          }}
                        >
                          ⚠️ <strong>Notice:</strong> {message.warningMessage}
                        </div>
                      )}

                      {/* Action Buttons & Synthesized Answer Container with Side-by-Side Flex Layout */}
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "row",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          gap: "16px",
                          width: "100%",
                        }}
                      >
                        {/* Output box on the left */}
                        <div className="report-sections-flow" style={{ flex: 1, minWidth: 0 }}>
                          <div className="report-section-block" style={{ width: "fit-content" }}>
                            <div className="report-section-title">📌 Synthesized Answer</div>
                            <div
                              className="formatted-answer-box"
                              dir={message.currentLanguage === "ar" ? "rtl" : "ltr"}
                            >
                              {message.isConversational
                                ? message.text
                                : formatAnswer(message.text)}
                            </div>
                          </div>
                        </div>

                        {/* Action buttons on the right (hidden on desktop via CSS class / media query if needed, or structured dynamically) */}
                        <div
                          className="desktop-action-buttons-wrapper"
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "8px",
                            flexShrink: 0,
                          }}
                        >
                          <button
                            type="button"
                            className="action-btn translate-btn mobile-hidden-action-btn"
                            onClick={() => translateMessage(index)}
                            disabled={message.translating}
                            style={{
                              padding: "6px 12px",
                              borderRadius: "8px",
                              border: "1px solid #0284c7",
                              background: "rgba(2, 132, 199, 0.1)",
                              color: isDarkMode ? "#38bdf8" : "#0284c7",
                              fontWeight: "600",
                              cursor: "pointer",
                              fontSize: "0.85rem",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {message.translating
                              ? "⏳ Translating..."
                              : message.currentLanguage === "ar"
                              ? "🌐 Translate to English"
                              : "🌐 Translate to Arabic"}
                          </button>
                          <button
                            type="button"
                            className="action-btn speak-btn mobile-hidden-action-btn"
                            onClick={() => speakAnswer(message.text, index)}
                            style={{
                              padding: "6px 12px",
                              borderRadius: "8px",
                              border: "1px solid #059669",
                              background: "rgba(5, 150, 105, 0.1)",
                              color: isDarkMode ? "#34d399" : "#059669",
                              fontWeight: "600",
                              cursor: "pointer",
                              fontSize: "0.85rem",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {speakingIndex === index ? "🛑 Stop Reading" : "🔊 Read Aloud"}
                          </button>
                          <button
                            type="button"
                            className="action-btn copy-btn mobile-hidden-action-btn"
                            onClick={() => copyResponseText(message.text, index)}
                            style={{
                              padding: "6px 12px",
                              borderRadius: "8px",
                              border: "1px solid #64748b",
                              background: "rgba(100, 116, 139, 0.1)",
                              color: isDarkMode ? "#cbd5e1" : "#475569",
                              fontWeight: "600",
                              cursor: "pointer",
                              fontSize: "0.85rem",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {message.copied ? "✨ Copied!" : "📋 Copy Report"}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div dir={detectLanguage(message.text) === "ar" ? "rtl" : "ltr"}>
                      {message.text}
                    </div>
                  )}
                </div>

                {isBot && message.sources?.length > 0 && (
                  <div className="sources-dropdown-container">
                    <details>
                      <summary className="sources-dropdown-header">
                        📚 Supporting Evidence & Guidelines ({message.sources.length})
                        <span>▼</span>
                      </summary>
                      <div className="sources-dropdown-content">
                        {message.sources.map((source, sourceIndex) => {
                          const docName =
                            source?.metadata?.document_name ||
                            source?.metadata?.filename ||
                            "KDIGO Clinical Guidelines";
                          const pageNum =
                            source?.metadata?.page || source?.metadata?.page_number || "N/A";
                          const sourceText = source?.content || source?.text || "No snippet available.";

                          return (
                            <div
                              className="source-item-card"
                              key={sourceIndex}
                              style={{ display: "flex", flexDirection: "column", gap: "4px" }}
                            >
                              <span className="source-tag">Reference Item [{sourceIndex + 1}]</span>
                              <div className="source-line">
                                <strong>document name:</strong> {docName}
                              </div>
                              <div className="source-line">
                                <strong>page:</strong> {pageNum}
                              </div>
                              <div className="source-line">
                                <strong>source:</strong> "{sourceText}"
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  </div>
                )}
              </div>
            );
          })}

          {loading && (
            <div className="message-row bot-row" ref={latestMessageRef}>
              <div className="message-bubble bot-bubble">
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  ⏳ Synthesizing clinical guidelines...
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Chat Input Form */}
        <form
          onSubmit={handleSubmit}
          className="chat-input-form"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "14px",
            background: isDarkMode ? "rgba(30,41,59,0.95)" : "rgba(255,255,255,0.95)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(150,150,150,0.3)",
            padding: "12px 20px",
            borderRadius: "16px",
            width: "calc(100% - 40px)",
            maxWidth: "1000px",
            position: "absolute",
            bottom: "15px",
            left: "50%",
            transform: "translateX(-50%)",
            boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
            zIndex: 99,
          }}
        >
          <button
            type="button"
            onClick={toggleVoiceInput}
            disabled={loading}
            style={{
              background: isListening ? "rgba(239,68,68,0.4)" : "rgba(255,255,255,0.2)",
              border: isListening ? "2px solid #ef4444" : "1px solid rgba(255,255,255,0.4)",
              cursor: loading ? "not-allowed" : "pointer",
              fontSize: "1.1rem",
              padding: "8px 10px",
              borderRadius: "10px",
              opacity: loading ? 0.5 : 1,
            }}
            title={isListening ? "Listening... Click to stop" : "Voice Input"}
          >
            {isListening ? "🔴" : "🎙️"}
          </button>

          <input
            type="text"
            value={input}
            onChange={(e) => {
              const value = e.target.value;
              setInput(value);
              inputValRef.current = value;
            }}
            placeholder={
              isListening
                ? "Listening to your voice..."
                : "Ask about CKD management, KDIGO staging, prescriptions..."
            }
            disabled={loading}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              color: "inherit",
              fontSize: "1rem",
              outline: "none",
            }}
          />

          <button
            type="submit"
            disabled={loading || !input.trim()}
            style={{
              padding: "8px 18px",
              borderRadius: "10px",
              border: "none",
              fontWeight: "bold",
              cursor: loading || !input.trim() ? "not-allowed" : "pointer",
              background: "#0284c7",
              color: "#fff",
              opacity: loading || !input.trim() ? "0.6" : "1",
            }}
          >
            Send 🚀
          </button>
        </form>
      </main>

      {/* Retractable Right-Side Panel (Risk & Safety Report + Mobile-Only Action Buttons) */}
      <aside
        style={{
          width: "320px",
          minWidth: "320px",
          maxWidth: "320px",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          boxSizing: "border-box",
          overflowY: "auto",
          zIndex: 10,
          backgroundColor: isDarkMode ? "#0f172a" : "#f8fafc",
          borderLeft: isDarkMode ? "1px solid #334155" : "1px solid #e2e8f0",
          padding: "20px",
          transform: isRightPanelOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.3s ease",
          position: isRightPanelOpen ? "relative" : "absolute",
          right: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "15px" }}>
          <h3 style={{ margin: 0, fontSize: "1.1rem", display: "flex", alignItems: "center", gap: "8px" }}>
            🛡️ Risk & Safety Panel
          </h3>
          <button
            onClick={() => setIsRightPanelOpen(false)}
            style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: "1.1rem", color: "inherit" }}
          >
            ✕
          </button>
        </div>

        {/* Mobile-Only Action Buttons Section inside the Right Retractable Panel */}
        <div className="mobile-only-actions-section" style={{ display: "none", marginBottom: "20px", paddingBottom: "15px", borderBottom: "1px solid rgba(150,150,150,0.2)" }}>
          <div style={{ fontWeight: "bold", marginBottom: "10px", fontSize: "0.9rem" }}>
            📱 Response Actions (Mobile):
          </div>
          {messages.length > 0 && messages[messages.length - 1].sender === "bot" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {(() => {
                const latestBotIndex = messages.length - 1;
                const latestMsg = messages[latestBotIndex];
                return (
                  <>
                    <button
                      type="button"
                      onClick={() => translateMessage(latestBotIndex)}
                      disabled={latestMsg.translating}
                      style={{
                        padding: "8px 12px",
                        borderRadius: "8px",
                        border: "1px solid #0284c7",
                        background: "rgba(2, 132, 199, 0.1)",
                        color: isDarkMode ? "#38bdf8" : "#0284c7",
                        fontWeight: "600",
                        cursor: "pointer",
                        fontSize: "0.85rem",
                        textAlign: "left",
                      }}
                    >
                      {latestMsg.translating
                        ? "⏳ Translating..."
                        : latestMsg.currentLanguage === "ar"
                        ? "🌐 Translate to English"
                        : "🌐 Translate to Arabic"}
                    </button>
                    <button
                      type="button"
                      onClick={() => speakAnswer(latestMsg.text, latestBotIndex)}
                      style={{
                        padding: "8px 12px",
                        borderRadius: "8px",
                        border: "1px solid #059669",
                        background: "rgba(5, 150, 105, 0.1)",
                        color: isDarkMode ? "#34d399" : "#059669",
                        fontWeight: "600",
                        cursor: "pointer",
                        fontSize: "0.85rem",
                        textAlign: "left",
                      }}
                    >
                      {speakingIndex === latestBotIndex ? "🛑 Stop Reading" : "🔊 Read Aloud"}
                    </button>
                    <button
                      type="button"
                      onClick={() => copyResponseText(latestMsg.text, latestBotIndex)}
                      style={{
                        padding: "8px 12px",
                        borderRadius: "8px",
                        border: "1px solid #64748b",
                        background: "rgba(100, 116, 139, 0.1)",
                        color: isDarkMode ? "#cbd5e1" : "#475569",
                        fontWeight: "600",
                        cursor: "pointer",
                        fontSize: "0.85rem",
                        textAlign: "left",
                      }}
                    >
                      {latestMsg.copied ? "✨ Copied!" : "📋 Copy Report"}
                    </button>
                  </>
                );
              })()}
            </div>
          ) : (
            <div style={{ fontSize: "0.8rem", opacity: 0.6 }}>No active bot message available.</div>
          )}
        </div>

        <p style={{ fontSize: "0.85rem", opacity: 0.8, marginBottom: "20px" }}>
          This panel monitors metrics like answer faithfulness and context relevance across your RAG queries.
        </p>

        {messages.length > 0 && messages[messages.length - 1].evaluationMetrics ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {(() => {
              const lastMsg = messages[messages.length - 1];
              const metrics = lastMsg.evaluationMetrics;
              if (!metrics) return <p style={{ fontSize: "0.85rem" }}>No metrics for current conversation turn.</p>;
              const faith = Number(metrics.faithfulness_score ?? 1);
              const contextRel = Number(metrics.context_relevance_score ?? 1);
              const highRisk = contextRel < 0.3 || faith < 0.8 || String(metrics.hallucination_risk || "").toLowerCase().includes("high");

              return (
                <div
                  style={{
                    padding: "14px",
                    borderRadius: "12px",
                    background: isDarkMode ? "#1e293b" : "#ffffff",
                    border: highRisk ? "1px solid #ef4444" : "1px solid #10b981",
                  }}
                >
                  <div style={{ fontWeight: "bold", marginBottom: "10px", fontSize: "0.9rem" }}>
                    Latest Turn Safety Metrics:
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "0.85rem" }}>
                    <div>Faithfulness: <strong>{faith >= 0.8 ? "🟢 ✔️" : "🔴 ❌"} {metrics.faithfulness_score}</strong></div>
                    <div>Answer Relevance: <strong>{metrics.answer_relevance_score}</strong></div>
                    <div>Context Relevance: <strong>{metrics.context_relevance_score}</strong></div>
                    <div>Risk Status: <strong style={{ color: highRisk ? "#ef4444" : "#10b981" }}>{highRisk ? "High Risk" : metrics.hallucination_risk}</strong></div>
                  </div>
                </div>
              );
            })()}
          </div>
        ) : (
          <div style={{ fontSize: "0.85rem", opacity: 0.6 }}>
            Ask a clinical question to view real-time RAG evaluation and safety metrics here.
          </div>
        )}
      </aside>

      {/* Inline Responsive Styles for Mobile-Only Action Controls */}
      <style>{`
        @media (max-width: 768px) {
          .mobile-hidden-action-btn {
            display: none !important;
          }
          .mobile-only-actions-section {
            display: flex !important;
            flex-direction: column !important;
          }
        }
      `}</style>
    </div>
  );
}