import React, { useEffect, useRef, useState } from "react";
import logo from "./assets/logo.png";
import bgImage from "./assets/background.png";
import KidneyModel from "./CKDCalculatorWidget";
import "./App.css";

/* =========================================================
   VERCEL / API CONFIGURATION
   ========================================================= */

const RAW_API_URL = import.meta.env.VITE_API_URL || "";
const API_URL = RAW_API_URL.replace(/\/+$/, "");

/*
  When VITE_API_URL is empty:
    1. Try /api/chat
    2. If that is a 404, try /chat

  This lets the same frontend work with:
    - Vercel /api/chat serverless functions
    - Vercel rewrites such as /chat -> backend/main.py
*/
const API_ENDPOINTS = API_URL
  ? [`${API_URL}/chat`]
  : ["/api/chat", "/chat"];

/* =========================================================
   LANGUAGE
   ========================================================= */

const detectLanguage = (text = "") => {
  const arabic = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const english = (text.match(/[A-Za-z]/g) || []).length;

  return arabic > 0 && arabic >= english ? "ar" : "en";
};

/* =========================================================
   TEXT CLEANING
   ========================================================= */

const cleanMarkdown = (text = "") =>
  String(text)
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/^#+\s?/gm, "")
    .replace(/^[-*]\s?/gm, "")
    .trim();

/* =========================================================
   FORMAT ANSWER
   ========================================================= */

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

  const parsedItems = rawLines
    .map((line) => line.trim())
    .filter(Boolean);

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
   APP
   ========================================================= */

export default function App() {
  const [messages, setMessages] = useState([
    {
      sender: "bot",
      text:
        "Hello! I'm MedCreative, your clinical assistant ready to help with CKD and KDIGO guidelines. How may I help you today? 😊",
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

  /* =========================================================
     DEBUG
     ========================================================= */

  useEffect(() => {
    console.log(
      "MedCreative API base:",
      API_URL || "relative Vercel routes"
    );

    console.log(
      "MedCreative API endpoints:",
      API_ENDPOINTS
    );
  }, []);

  /* =========================================================
     INPUT REF
     ========================================================= */

  useEffect(() => {
    inputValRef.current = input;
  }, [input]);

  /* =========================================================
     AUTO SCROLL
     ========================================================= */

  useEffect(() => {
    latestMessageRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [messages.length, loading]);

  /* =========================================================
     SPEECH RECOGNITION
     ========================================================= */

  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition;

    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();

    recognition.continuous = false;
    recognition.interimResults = true;

    /*
      Arabic is used here because your application supports
      Egyptian Arabic. The final question is still detected
      automatically by detectLanguage().
    */
    recognition.lang = "ar-EG";

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event) => {
      let transcript = "";

      for (
        let i = event.resultIndex;
        i < event.results.length;
        i++
      ) {
        transcript += event.results[i][0].transcript;
      }

      if (transcript.trim()) {
        setInput(transcript.trim());
      }
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition error:", event.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);

      const spokenText = inputValRef.current.trim();

      if (spokenText) {
        setTimeout(() => {
          handleSubmit(null, spokenText);
        }, 300);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      try {
        recognition.stop();
      } catch {
        // Ignore cleanup errors.
      }
    };
  }, []);

  /* =========================================================
     VOICE INPUT
     ========================================================= */

  const toggleVoiceInput = async () => {
    const SpeechRecognition =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert(
        "Speech recognition is not supported in this browser."
      );
      return;
    }

    if (isListening) {
      try {
        recognitionRef.current?.stop();
      } catch {
        // Ignore.
      }

      setIsListening(false);
      return;
    }

    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream =
          await navigator.mediaDevices.getUserMedia({
            audio: true,
          });

        stream
          .getTracks()
          .forEach((track) => track.stop());
      }

      recognitionRef.current?.start();
    } catch (error) {
      console.error("Microphone error:", error);

      setIsListening(false);

      alert(
        "Could not access the microphone. Please allow microphone access in your browser."
      );
    }
  };

  /* =========================================================
     COPY RESPONSE
     ========================================================= */

  const copyResponseText = async (text, index) => {
    try {
      await navigator.clipboard.writeText(
        cleanMarkdown(text)
      );

      setMessages((previous) =>
        previous.map((message, messageIndex) =>
          messageIndex === index
            ? { ...message, copied: true }
            : message
        )
      );

      setTimeout(() => {
        setMessages((previous) =>
          previous.map((message, messageIndex) =>
            messageIndex === index
              ? { ...message, copied: false }
              : message
          )
        );
      }, 2000);
    } catch (error) {
      console.error("Copy failed:", error);
      alert("Could not copy the response.");
    }
  };

  /* =========================================================
     TEXT TO SPEECH
     ========================================================= */

  const speakAnswer = (text, index) => {
    if (!("speechSynthesis" in window)) {
      alert(
        "Text-to-speech is not supported in this browser."
      );
      return;
    }

    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      setSpeakingIndex(null);
      return;
    }

    const message = messages[index];

    const utterance =
      new SpeechSynthesisUtterance(
        cleanMarkdown(text)
      );

    utterance.lang =
      message?.currentLanguage === "ar"
        ? "ar-EG"
        : "en-US";

    utterance.rate = 1;

    utterance.onstart = () => {
      setSpeakingIndex(index);
    };

    utterance.onend = () => {
      setSpeakingIndex(null);
    };

    utterance.onerror = () => {
      setSpeakingIndex(null);
    };

    window.speechSynthesis.speak(utterance);
  };

  /* =========================================================
     TRANSLATION
     ========================================================= */

  const translateMessage = async (index) => {
    const message = messages[index];

    if (!message) return;

    /*
      If translation already exists, simply switch between
      the original and cached translation.
    */
    if (message.cachedTranslation) {
      setMessages((previous) =>
        previous.map((item, itemIndex) => {
          if (itemIndex !== index) return item;

          const switchingToEnglish =
            item.currentLanguage === "ar";

          return {
            ...item,
            text: switchingToEnglish
              ? item.originalText
              : item.cachedTranslation,
            currentLanguage: switchingToEnglish
              ? "en"
              : "ar",
          };
        })
      );

      return;
    }

    setMessages((previous) =>
      previous.map((item, itemIndex) =>
        itemIndex === index
          ? { ...item, translating: true }
          : item
      )
    );

    try {
      const sourceLanguage =
        message.currentLanguage || "en";

      const targetLanguage =
        sourceLanguage === "ar" ? "en" : "ar";

      const textToTranslate =
        message.originalText || message.text;

      const maxChunkLength = 450;

      const translatedChunks = [];

      for (
        let i = 0;
        i < textToTranslate.length;
        i += maxChunkLength
      ) {
        const chunk = textToTranslate.substring(
          i,
          i + maxChunkLength
        );

        const response = await fetch(
          `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
            chunk
          )}&langpair=${sourceLanguage}|${targetLanguage}`
        );

        if (!response.ok) {
          throw new Error(
            "Translation service failed."
          );
        }

        const data = await response.json();

        translatedChunks.push(
          data.responseData?.translatedText ||
            chunk
        );
      }

      const translated =
        translatedChunks.join(" ");

      setMessages((previous) =>
        previous.map((item, itemIndex) =>
          itemIndex === index
            ? {
                ...item,
                originalText:
                  message.originalText ||
                  message.text,
                cachedTranslation: translated,
                text: translated,
                currentLanguage:
                  targetLanguage,
                translating: false,
              }
            : item
        )
      );
    } catch (error) {
      console.error("Translation error:", error);

      setMessages((previous) =>
        previous.map((item, itemIndex) =>
          itemIndex === index
            ? {
                ...item,
                translating: false,
              }
            : item
        )
      );

      alert(
        "Translation failed or exceeded the translation service limits."
      );
    }
  };

  /* =========================================================
     API REQUEST
     ========================================================= */

  const requestChat = async (payload) => {
    let lastError = null;

    for (const endpoint of API_ENDPOINTS) {
      try {
        console.log(
          "Trying MedCreative API endpoint:",
          endpoint
        );

        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        /*
          If this endpoint is a Vercel 404, try the next
          configured endpoint.

          Example:
            /api/chat -> 404
            then:
            /chat -> backend/main.py
        */
        if (response.status === 404) {
          lastError = new Error(
            `API route not found: ${endpoint}`
          );

          continue;
        }

        if (!response.ok) {
          let errorMessage =
            `Backend returned HTTP ${response.status}.`;

          try {
            const errorData =
              await response.json();

            if (errorData?.detail) {
              errorMessage = errorData.detail;
            }

            if (errorData?.message) {
              errorMessage = errorData.message;
            }
          } catch {
            // Response was not JSON.
          }

          throw new Error(errorMessage);
        }

        const data = await response.json();

        return data;
      } catch (error) {
        lastError = error;

        /*
          Only continue to another endpoint for a route
          failure. Other backend errors should be shown
          instead of hiding them.
        */
        if (
          !String(error?.message || "")
            .toLowerCase()
            .includes("route not found")
        ) {
          throw error;
        }
      }
    }

    throw (
      lastError ||
      new Error(
        "No working backend API route was found."
      )
    );
  };

  /* =========================================================
     CHAT SUBMISSION
     ========================================================= */

  const handleSubmit = async (
    event,
    customPrompt = null
  ) => {
    if (event) {
      event.preventDefault();
    }

    const rawInput = (
      customPrompt !== null
        ? customPrompt
        : input
    ).trim();

    if (!rawInput || loading) return;

    const language = detectLanguage(rawInput);

    if (customPrompt === null) {
      setInput("");
    }

    setIsPresetMenuOpen(false);

    /*
      Add user message immediately.
    */
    setMessages((previous) => [
      ...previous,
      {
        sender: "user",
        text: rawInput,
        currentLanguage: language,
      },
    ]);

    setLoading(true);

    try {
      const data = await requestChat({
        question: rawInput,
        top_k: retrievalK,
        distance_threshold: scoreThreshold,
      });

      const finalAnswer =
        data?.answer ||
        "No answer was returned by the backend.";

      let evalMetrics =
        data?.evaluation_metrics || null;

      /*
        Frontend safety display.
        The backend remains the source of truth.
      */
      if (evalMetrics) {
        const contextRelevance = Number(
          evalMetrics.context_relevance_score ?? 1
        );

        const faithfulness = Number(
          evalMetrics.faithfulness_score ?? 1
        );

        if (
          contextRelevance < 0.3 ||
          faithfulness < 0.8
        ) {
          evalMetrics = {
            ...evalMetrics,
            hallucination_risk:
              "High (Low Context/Faithfulness)",
          };
        }
      }

      setMessages((previous) => [
        ...previous,
        {
          sender: "bot",
          text: finalAnswer,
          originalText: finalAnswer,
          userPromptText: rawInput,
          sources: Array.isArray(data?.sources)
            ? data.sources
            : [],
          isConversational:
            Boolean(data?.is_conversational),
          evaluationMetrics: evalMetrics,
          warningMessage:
            data?.warning_message || null,
          currentLanguage:
            data?.language || language,
          cachedTranslation: null,
          translating: false,
          copied: false,
        },
      ]);
    } catch (error) {
      console.error(
        "MedCreative backend request failed:",
        error
      );

      const errorText =
        error?.message ||
        "Unable to connect to the backend.";

      setMessages((previous) => [
        ...previous,
        {
          sender: "bot",
          text:
            `⚠️ Connection Error: ${errorText}\n\n` +
            "If this is the deployed Vercel app, make sure your Vercel backend route is configured for /api/chat or /chat.",
          originalText:
            `⚠️ Connection Error: ${errorText}`,
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
    }
  };

  /* =========================================================
     SYMPTOM / RISK SCREENING
     ========================================================= */

  const handleSymptomToggle = (symptom) => {
    setSelectedSymptoms((previous) =>
      previous.includes(symptom)
        ? previous.filter(
            (item) => item !== symptom
          )
        : [...previous, symptom]
    );
  };

  const calculateCKDRisk = () => {
    const creatinine = Number(evalCreatinine);
    const urea = Number(evalUrea);
    const age = Number(evalAge);

    const symptomCount =
      selectedSymptoms.length;

    let riskLevel = "Low Risk";
    let stage =
      "No clear high-risk pattern detected.";
    let color = "#10b981";

    if (
      creatinine > 2.5 ||
      urea > 60 ||
      symptomCount >= 4
    ) {
      riskLevel = "High Risk";
      stage =
        "Needs clinical evaluation / possible advanced CKD.";
      color = "#ef4444";
    } else if (
      creatinine > 1.5 ||
      urea > 45 ||
      symptomCount >= 2
    ) {
      riskLevel = "Moderate Risk";
      stage =
        "Further kidney-function assessment is recommended.";
      color = "#f59e0b";
    } else if (
      creatinine > 1.2 ||
      urea > 35 ||
      symptomCount >= 1 ||
      age > 60
    ) {
      riskLevel = "Mild Risk";
      stage =
        "Consider further kidney-function assessment.";
      color = "#3b82f6";
    }

    setEvaluationResult({
      riskLevel,
      stage,
      color,
      symptomCount,
    });
  };

  /* =========================================================
     SYMPTOMS
     ========================================================= */

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

  /* =========================================================
     QUICK CLINICAL PRESETS
     ========================================================= */

  const clinicalPresets = [
    {
      q: "What is the normal GFR?",
      label: "What is the normal GFR?",
      emoji: "💧",
    },
    {
      q: "What are the KDIGO staging criteria for CKD based on GFR and Albuminuria?",
      label: "CKD Staging Criteria",
      emoji: "📊",
    },
    {
      q: "ايه هو الفشل الكلوي؟",
      label: "ما هو الفشل الكلوي؟",
      emoji: "🩺",
    },
    {
      q: "What are the guidelines for blood pressure management in CKD patients?",
      label: "Blood Pressure Targets",
      emoji: "❤️",
    },
    {
      q: "What is albuminuria?",
      label: "What is albuminuria?",
      emoji: "🧪",
    },
    {
      q: "How does water intake affect kidneys?",
      label: "Water & Kidney Health",
      emoji: "🌊",
    },
    {
      q: "What is a normal creatinine level?",
      label: "Normal Creatinine",
      emoji: "📈",
    },
    {
      q: "When should a CKD patient be referred to a nephrologist?",
      label: "Nephrology Referral",
      emoji: "🏥",
    },
    {
      q: "How do SGLT2 inhibitors protect the kidneys in diabetic kidney disease?",
      label: "SGLT2 Kidney Protection",
      emoji: "🛡️",
    },
  ];

  const causePresets = [
    {
      q: "What are the primary causes of chronic kidney disease (CKD)?",
      label: "Primary Causes of CKD",
      emoji: "🧬",
    },
    {
      q: "What causes acute kidney injury (AKI)?",
      label: "Acute Kidney Injury Causes",
      emoji: "⚡",
    },
    {
      q: "What causes diabetic nephropathy?",
      label: "Diabetic Nephropathy Etiology",
      emoji: "🩸",
    },
    {
      q: "What causes hypertensive nephrosclerosis?",
      label: "Hypertensive Nephrosclerosis",
      emoji: "❤️",
    },
  ];

  /* =========================================================
     RENDER
     ========================================================= */

  return (
    <div
      className={`page-wrapper ${
        isDarkMode
          ? "dark-theme"
          : "light-theme"
      }`}
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
      {/* =====================================================
          SIDEBAR TOGGLE
      ===================================================== */}

      <button
        onClick={() =>
          setIsSidebarOpen(
            (previous) => !previous
          )
        }
        title={
          isSidebarOpen
            ? "Collapse Sidebar"
            : "Open Sidebar"
        }
        style={{
          position: "fixed",
          top: "20px",
          left: isSidebarOpen
            ? "340px"
            : "20px",
          zIndex: 1000000,
          background:
            "linear-gradient(135deg, #0284c7, #0369a1)",
          border: "none",
          color: "#fff",
          padding: "10px 14px",
          borderRadius: "10px",
          cursor: "pointer",
          fontWeight: "700",
          boxShadow:
            "0 4px 15px rgba(0,0,0,0.2)",
          transition: "left 0.3s ease",
        }}
      >
        {isSidebarOpen
          ? "◀ Hide Sidebar"
          : "▶ Open Sidebar"}
      </button>

      {/* =====================================================
          QUICK PRESETS
      ===================================================== */}

      <div
        style={{
          position: "fixed",
          top: "20px",
          right: "30px",
          zIndex: 999999,
        }}
      >
        <button
          onClick={() =>
            setIsPresetMenuOpen(
              (previous) => !previous
            )
          }
          title="Quick Clinical Presets & Guidelines"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "10px 18px",
            background:
              "linear-gradient(135deg, #e4e0d8, #c8beaf)",
            border: "1px solid #b3a896",
            borderRadius: "30px",
            cursor: "pointer",
            color: "#2c2825",
            fontWeight: "700",
            boxShadow:
              "0 8px 25px rgba(0,0,0,0.15)",
          }}
        >
          <span style={{ fontSize: "1.2rem" }}>
            💊
          </span>

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
              background: isDarkMode
                ? "#1e293b"
                : "#ffffff",
              border: isDarkMode
                ? "1px solid #475569"
                : "1px solid #cbd5e1",
              borderRadius: "12px",
              padding: "14px",
              width: "360px",
              maxWidth: "calc(100vw - 40px)",
              boxShadow:
                "0 15px 35px rgba(0,0,0,0.3)",
              zIndex: 9999999,
            }}
          >
            <div
              style={{
                display: "flex",
                gap: "6px",
                marginBottom: "6px",
              }}
            >
              <button
                onClick={() =>
                  setPresetTab("questions")
                }
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
                  color:
                    presetTab === "questions"
                      ? "#fff"
                      : "inherit",
                  fontWeight: "700",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                }}
              >
                💊 Clinical Questions
              </button>

              <button
                onClick={() =>
                  setPresetTab("causes")
                }
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
                  color:
                    presetTab === "causes"
                      ? "#fff"
                      : "inherit",
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
                {clinicalPresets.map(
                  (preset, index) => (
                    <button
                      key={index}
                      onClick={() =>
                        handleSubmit(
                          null,
                          preset.q
                        )
                      }
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        textAlign: "left",
                        width: "100%",
                        padding: "10px 12px",
                        background: isDarkMode
                          ? "#253244"
                          : "#eef3f8",
                        border: isDarkMode
                          ? "1px solid #37475e"
                          : "1px solid #d8e2ed",
                        borderRadius: "10px",
                        cursor: "pointer",
                        color: isDarkMode
                          ? "#f8fafc"
                          : "#1e293b",
                        fontWeight: "500",
                        fontSize: "0.9rem",
                      }}
                    >
                      <span>
                        {preset.emoji}
                      </span>

                      <span>
                        {preset.label}
                      </span>
                    </button>
                  )
                )}
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
                <p
                  style={{
                    fontSize: "0.8rem",
                    margin:
                      "0 0 4px 0",
                    opacity: 0.8,
                  }}
                >
                  Explore primary disease
                  causes and etiologies:
                </p>

                {causePresets.map(
                  (preset, index) => (
                    <button
                      key={index}
                      onClick={() =>
                        handleSubmit(
                          null,
                          preset.q
                        )
                      }
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        textAlign: "left",
                        width: "100%",
                        padding: "10px 12px",
                        background: isDarkMode
                          ? "#16332c"
                          : "#e6f4ed",
                        border: isDarkMode
                          ? "1px solid #224d42"
                          : "1px solid #cce8d9",
                        borderRadius: "10px",
                        cursor: "pointer",
                        color: isDarkMode
                          ? "#f8fafc"
                          : "#1e293b",
                        fontWeight: "500",
                        fontSize: "0.9rem",
                      }}
                    >
                      <span>
                        {preset.emoji}
                      </span>

                      <span>
                        {preset.label}
                      </span>
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* =====================================================
          SYMPTOMS MODAL
      ===================================================== */}

      {isSymptomsModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            width: "100vw",
            height: "100vh",
            background:
              "rgba(0,0,0,0.7)",
            zIndex: 99999999,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: "20px",
          }}
        >
          <div
            style={{
              backgroundColor: isDarkMode
                ? "#1e293b"
                : "#ffffff",
              color: isDarkMode
                ? "#f8fafc"
                : "#0f172a",
              borderRadius: "16px",
              width: "100%",
              maxWidth: "680px",
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow:
                "0 20px 40px rgba(0,0,0,0.4)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent:
                  "space-between",
                alignItems: "center",
                padding: "16px 20px",
                borderBottom:
                  "1px solid rgba(150,150,150,0.2)",
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: "1.2rem",
                }}
              >
                ❤️ CKD Symptoms & Risk
                Assessment
              </h3>

              <button
                onClick={() =>
                  setIsSymptomsModalOpen(
                    false
                  )
                }
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
                padding:
                  "8px 12px 0",
                background: isDarkMode
                  ? "#0f172a"
                  : "#f8fafc",
              }}
            >
              <button
                onClick={() =>
                  setSymptomsTab(
                    "overview"
                  )
                }
                style={{
                  flex: 1,
                  padding: "10px",
                  borderRadius:
                    "8px 8px 0 0",
                  border: "none",
                  background:
                    symptomsTab ===
                    "overview"
                      ? "linear-gradient(135deg, #0284c7, #0369a1)"
                      : isDarkMode
                      ? "#1e293b"
                      : "#e2e8f0",
                  color:
                    symptomsTab ===
                    "overview"
                      ? "#fff"
                      : "inherit",
                  fontWeight: "700",
                  cursor: "pointer",
                }}
              >
                📋 Symptoms Overview
              </button>

              <button
                onClick={() =>
                  setSymptomsTab(
                    "evaluator"
                  )
                }
                style={{
                  flex: 1,
                  padding: "10px",
                  borderRadius:
                    "8px 8px 0 0",
                  border: "none",
                  background:
                    symptomsTab ===
                    "evaluator"
                      ? "linear-gradient(135deg, #059669, #047857)"
                      : isDarkMode
                      ? "#1e293b"
                      : "#e2e8f0",
                  color:
                    symptomsTab ===
                    "evaluator"
                      ? "#fff"
                      : "inherit",
                  fontWeight: "700",
                  cursor: "pointer",
                }}
              >
                🧪 Risk Screening
              </button>
            </div>

            <div
              style={{ padding: "20px" }}
            >
              {symptomsTab ===
                "overview" && (
                <div>
                  <div
                    style={{
                      backgroundColor:
                        isDarkMode
                          ? "#0f172a"
                          : "#f1f5f9",
                      borderRadius:
                        "14px",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        background:
                          "linear-gradient(135deg, #0284c7, #0369a1)",
                        color: "#fff",
                        padding:
                          "14px 18px",
                        fontWeight: "700",
                      }}
                    >
                      ❤️ Common Renal
                      Manifestations
                    </div>

                    <div
                      style={{
                        padding: "16px",
                        display: "grid",
                        gridTemplateColumns:
                          "1fr 1fr",
                        gap: "12px",
                        fontSize:
                          "0.85rem",
                      }}
                    >
                      <div
                        style={{
                          background:
                            isDarkMode
                              ? "#1e293b"
                              : "#ffffff",
                          padding: "12px",
                          borderRadius:
                            "10px",
                        }}
                      >
                        <strong>
                          💧 Fluid & Urinary
                        </strong>
                        <p>
                          Foamy urine,
                          swelling, and
                          changes in
                          urine output.
                        </p>
                      </div>

                      <div
                        style={{
                          background:
                            isDarkMode
                              ? "#1e293b"
                              : "#ffffff",
                          padding: "12px",
                          borderRadius:
                            "10px",
                        }}
                      >
                        <strong>
                          ⚡ Metabolic &
                          Energy
                        </strong>
                        <p>
                          Fatigue,
                          weakness, and
                          muscle cramps.
                        </p>
                      </div>

                      <div
                        style={{
                          background:
                            isDarkMode
                              ? "#1e293b"
                              : "#ffffff",
                          padding: "12px",
                          borderRadius:
                            "10px",
                        }}
                      >
                        <strong>
                          🩸 Cardiovascular
                        </strong>
                        <p>
                          Hypertension
                          and possible
                          shortness of
                          breath.
                        </p>
                      </div>

                      <div
                        style={{
                          background:
                            isDarkMode
                              ? "#1e293b"
                              : "#ffffff",
                          padding: "12px",
                          borderRadius:
                            "10px",
                        }}
                      >
                        <strong>
                          🧬 Dermatologic &
                          GI
                        </strong>
                        <p>
                          Dry/itchy skin,
                          nausea, and
                          appetite
                          changes.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {symptomsTab ===
                "evaluator" && (
                <div>
                  <p
                    style={{
                      fontSize: "0.9rem",
                      opacity: 0.9,
                    }}
                  >
                    Select symptoms and
                    enter basic laboratory
                    information for a simple
                    screening estimate.
                  </p>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "1fr 1fr",
                      gap: "8px",
                      marginBottom:
                        "20px",
                    }}
                  >
                    {symptoms.map(
                      (
                        symptom,
                        index
                      ) => {
                        const selected =
                          selectedSymptoms.includes(
                            symptom
                          );

                        return (
                          <div
                            key={index}
                            onClick={() =>
                              handleSymptomToggle(
                                symptom
                              )
                            }
                            style={{
                              padding:
                                "8px 12px",
                              borderRadius:
                                "8px",
                              border: selected
                                ? "1px solid #059669"
                                : "1px solid rgba(150,150,150,0.3)",
                              backgroundColor:
                                selected
                                  ? isDarkMode
                                    ? "#064e3b"
                                    : "#d1fae5"
                                  : isDarkMode
                                  ? "#0f172a"
                                  : "#f8fafc",
                              cursor:
                                "pointer",
                              fontSize:
                                "0.85rem",
                              display:
                                "flex",
                              alignItems:
                                "center",
                              gap: "8px",
                            }}
                          >
                            <span>
                              {selected
                                ? "💊"
                                : "🔹"}
                            </span>

                            <span>
                              {symptom}
                            </span>
                          </div>
                        );
                      }
                    )}
                  </div>

                  <div
                    style={{
                      backgroundColor:
                        isDarkMode
                          ? "#0f172a"
                          : "#f8fafc",
                      padding: "15px",
                      borderRadius:
                        "10px",
                      display: "grid",
                      gridTemplateColumns:
                        "1fr 1fr 1fr",
                      gap: "10px",
                    }}
                  >
                    <div>
                      <label>Age</label>
                      <input
                        type="number"
                        value={evalAge}
                        onChange={(e) =>
                          setEvalAge(
                            e.target.value
                          )
                        }
                        style={{
                          width: "100%",
                          padding:
                            "6px",
                        }}
                      />
                    </div>

                    <div>
                      <label>
                        Creatinine
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        value={
                          evalCreatinine
                        }
                        onChange={(e) =>
                          setEvalCreatinine(
                            e.target.value
                          )
                        }
                        style={{
                          width: "100%",
                          padding:
                            "6px",
                        }}
                      />
                    </div>

                    <div>
                      <label>Urea</label>
                      <input
                        type="number"
                        value={evalUrea}
                        onChange={(e) =>
                          setEvalUrea(
                            e.target.value
                          )
                        }
                        style={{
                          width: "100%",
                          padding:
                            "6px",
                        }}
                      />
                    </div>
                  </div>

                  <button
                    onClick={
                      calculateCKDRisk
                    }
                    style={{
                      width: "100%",
                      marginTop:
                        "15px",
                      padding:
                        "10px",
                      backgroundColor:
                        "#059669",
                      color: "#fff",
                      border: "none",
                      borderRadius:
                        "8px",
                      fontWeight:
                        "bold",
                      cursor:
                        "pointer",
                    }}
                  >
                    Run Screening
                    Assessment 🚀
                  </button>

                  {evaluationResult && (
                    <div
                      style={{
                        marginTop:
                          "15px",
                        padding:
                          "12px",
                        borderRadius:
                          "8px",
                        borderLeft:
                          `5px solid ${evaluationResult.color}`,
                        backgroundColor:
                          isDarkMode
                            ? "#0f172a"
                            : "#f1f5f9",
                      }}
                    >
                      <h4
                        style={{
                          color:
                            evaluationResult.color,
                          margin:
                            "0 0 5px 0",
                        }}
                      >
                        {
                          evaluationResult.riskLevel
                        }
                      </h4>

                      <p>
                        <strong>
                          Screening
                          result:
                        </strong>{" "}
                        {
                          evaluationResult.stage
                        }
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================
          SIDEBAR
      ===================================================== */}

      <aside
        className="sidebar"
        style={{
          width: "320px",
          minWidth: "320px",
          maxWidth: "320px",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent:
            "space-between",
          flexShrink: 0,
          boxSizing: "border-box",
          overflowY: "auto",
          zIndex: 10,
          transform: isSidebarOpen
            ? "translateX(0)"
            : "translateX(-100%)",
          transition:
            "transform 0.3s ease",
          position: isSidebarOpen
            ? "relative"
            : "absolute",
        }}
      >
        <div>
          <div
            className="sidebar-header"
            style={{
              marginTop: "10px",
            }}
          >
            <div className="sidebar-brand">
              <h2>
                🥼🩺 MedCreative
              </h2>

              <span>
                CLINICAL RAG ASSISTANT
              </span>
            </div>

            <img
              src={logo}
              alt="MedCreative Logo"
              className="sidebar-logo"
            />
          </div>

          <div
            style={{
              padding: "0 10px",
              marginBottom: "15px",
            }}
          >
            <button
              onClick={() =>
                setIsSymptomsModalOpen(
                  true
                )
              }
              style={{
                width: "100%",
                padding:
                  "12px 16px",
                borderRadius:
                  "12px",
                border:
                  "1px solid #cbd5e1",
                backgroundColor:
                  isDarkMode
                    ? "#1e293b"
                    : "#ffffff",
                color: isDarkMode
                  ? "#f8fafc"
                  : "#0f172a",
                fontWeight: "700",
                cursor: "pointer",
              }}
            >
              ❤️ 🩺 Symptoms &
              Risk Menu
            </button>
          </div>

          <div className="control-section">
            <h3>
              3D Interactive Model
            </h3>

            <KidneyModel />
          </div>
        </div>

        <div
          className="sidebar-footer"
          style={{
            paddingBottom: "20px",
          }}
        >
          <button
            type="button"
            className="theme-toggle-modern-btn"
            onClick={() =>
              setIsDarkMode(
                (previous) =>
                  !previous
              )
            }
            style={{
              width: "100%",
              padding:
                "12px 16px",
              borderRadius:
                "10px",
              border:
                "1px solid rgba(150,150,150,0.3)",
              backgroundColor:
                isDarkMode
                  ? "#ffffff"
                  : "#1e293b",
              color: isDarkMode
                ? "#0f172a"
                : "#ffffff",
              fontWeight: "700",
              cursor: "pointer",
              marginBottom:
                "15px",
            }}
          >
            {isDarkMode
              ? "☀️ Switch to Light Mode"
              : "🌙 Switch to Dark Mode"}
          </button>

          <div
            className="control-section"
            style={{
              marginTop: "10px",
              borderTop:
                "1px solid rgba(150,150,150,0.2)",
              paddingTop:
                "12px",
            }}
          >
            <h3
              style={{
                fontSize:
                  "0.9rem",
              }}
            >
              Parameters
            </h3>

            <div
              className="control-group"
              style={{
                marginBottom:
                  "8px",
              }}
            >
              <label>
                Retrieval K:{" "}
                {retrievalK}
              </label>

              <input
                type="range"
                min="1"
                max="10"
                value={retrievalK}
                onChange={(e) =>
                  setRetrievalK(
                    Number(
                      e.target.value
                    )
                  )
                }
                style={{
                  width: "100%",
                }}
              />
            </div>

            <div className="control-group">
              <label>
                Distance Threshold:{" "}
                {scoreThreshold}
              </label>

              <input
                type="range"
                min="0.1"
                max="2.0"
                step="0.05"
                value={
                  scoreThreshold
                }
                onChange={(e) =>
                  setScoreThreshold(
                    Number(
                      e.target.value
                    )
                  )
                }
                style={{
                  width: "100%",
                }}
              />
            </div>
          </div>
        </div>
      </aside>

      {/* =====================================================
          MAIN APP
      ===================================================== */}

      <main
        className="app-container"
        style={{
          backgroundImage:
            `url(${bgImage})`,
          backgroundSize:
            "cover",
          backgroundPosition:
            "center",
          backgroundRepeat:
            "no-repeat",
          position: "relative",
          display: "flex",
          flexDirection:
            "column",
          flex: 1,
          height: "100%",
          overflow: "hidden",
          boxSizing:
            "border-box",
        }}
      >
        <div
          className="dashboard-header"
          style={{
            flexShrink: 0,
            padding:
              "15px 20px",
          }}
        >
          <h1
            style={{
              display: "flex",
              alignItems:
                "center",
              gap: "10px",
              justifyContent:
                "center",
              margin: 0,
              fontSize:
                "1.5rem",
            }}
          >
            ❤️ 🥼🩺 Chronic
            Kidney Disease
            (CKD) - RAG
          </h1>

          <p
            className="subtitle"
            style={{
              margin:
                "4px 0 0 0",
              textAlign:
                "center",
              fontSize:
                "0.85rem",
            }}
          >
            Clinical Question →
            Answer → Evidence →
            Recommendations →
            Risk/Safety Report 👨‍⚕️
          </p>
        </div>

        {/* ===================================================
            CHAT
        =================================================== */}

        <div
          className="chat-box"
          style={{
            flex: 1,
            overflowY:
              "auto",
            padding:
              "0 20px 100px 20px",
            boxSizing:
              "border-box",
            display: "flex",
            flexDirection:
              "column",
          }}
        >
          {messages.map(
            (message, index) => {
              const isBot =
                message.sender ===
                "bot";

              const metrics =
                message.evaluationMetrics;

              const contextRel =
                Number(
                  metrics?.context_relevance_score ??
                    1
                );

              const faith =
                Number(
                  metrics?.faithfulness_score ??
                    1
                );

              const highRisk =
                metrics &&
                (
                  contextRel <
                    0.3 ||
                  faith < 0.8 ||
                  String(
                    metrics.hallucination_risk ||
                      ""
                  )
                    .toLowerCase()
                    .includes("high")
                );

              const isSmallOutput =
                message.text &&
                message.text.length <
                  80;

              return (
                <div
                  key={index}
                  ref={
                    index ===
                    messages.length -
                      1
                      ? latestMessageRef
                      : null
                  }
                  className={`message-row ${
                    isBot
                      ? "bot-row"
                      : "user-row"
                  }`}
                >
                  <div
                    className={`message-bubble ${
                      isBot
                        ? "bot-bubble"
                        : "user-bubble"
                    }`}
                  >
                    {isBot ? (
                      <div className="bot-bubble-content-wrapper">
                        {message.warningMessage && (
                          <div
                            style={{
                              backgroundColor:
                                "#fff3cd",
                              color:
                                "#856404",
                              padding:
                                "10px 14px",
                              borderRadius:
                                "6px",
                              marginBottom:
                                "12px",
                            }}
                          >
                            ⚠️{" "}
                            <strong>
                              Notice:
                            </strong>{" "}
                            {
                              message.warningMessage
                            }
                          </div>
                        )}

                        <div className="report-sections-flow">
                          <div
                            className="report-section-block"
                            style={{
                              width:
                                "fit-content",
                            }}
                          >
                            <div className="report-section-title">
                              📌 Synthesized
                              Answer
                            </div>

                            <div
                              className="formatted-answer-box"
                              dir={
                                message.currentLanguage ===
                                "ar"
                                  ? "rtl"
                                  : "ltr"
                              }
                            >
                              {message.isConversational
                                ? message.text
                                : formatAnswer(
                                    message.text
                                  )}
                            </div>
                          </div>
                        </div>

                        {/* =================================
                            RISK / SAFETY PANEL
                        ================================= */}

                        <div className="right-panel-dropdown-container">
                          <details>
                            <summary className="right-panel-dropdown-header">
                              <span>
                                🛡️ Risk &
                                Safety Report
                              </span>

                              <span className="dropdown-arrow">
                                ▼
                              </span>
                            </summary>

                            <div className="right-panel-stack">
                              <div
                                className="action-buttons-stack"
                                style={{
                                  gap: "6px",
                                }}
                              >
                                <button
                                  type="button"
                                  className="action-btn translate-btn"
                                  onClick={() =>
                                    translateMessage(
                                      index
                                    )
                                  }
                                  disabled={
                                    message.translating
                                  }
                                >
                                  {message.translating
                                    ? "⏳ Translating..."
                                    : message.currentLanguage ===
                                      "ar"
                                    ? "🌐 Translate to English"
                                    : "🌐 Translate to Arabic"}
                                </button>

                                <button
                                  type="button"
                                  className="action-btn speak-btn"
                                  onClick={() =>
                                    speakAnswer(
                                      message.text,
                                      index
                                    )
                                  }
                                >
                                  {speakingIndex ===
                                  index
                                    ? "🛑 Stop Reading"
                                    : "🔊 Read Aloud"}
                                </button>

                                <button
                                  type="button"
                                  className="action-btn copy-btn"
                                  onClick={() =>
                                    copyResponseText(
                                      message.text,
                                      index
                                    )
                                  }
                                >
                                  {message.copied
                                    ? "✨ Copied!"
                                    : "📋 Copy Report"}
                                </button>
                              </div>

                              {metrics &&
                                !isSmallOutput && (
                                  <div
                                    className={`evaluation-metrics-panel ${
                                      highRisk
                                        ? "panel-risk-high"
                                        : "panel-risk-low"
                                    }`}
                                  >
                                    <div className="metrics-header">
                                      🛡️ RISK &
                                      SAFETY REPORT
                                    </div>

                                    <div className="metrics-grid">
                                      <div className="metric-tag">
                                        Faithfulness:{" "}
                                        <strong>
                                          {faith >=
                                          0.8
                                            ? "🟢 ✔️"
                                            : "🔴 ❌"}{" "}
                                          {
                                            metrics.faithfulness_score
                                          }
                                        </strong>
                                      </div>

                                      <div className="metric-tag">
                                        Answer
                                        Relevance:{" "}
                                        <strong>
                                          {
                                            metrics.answer_relevance_score
                                          }
                                        </strong>
                                      </div>

                                      <div className="metric-tag">
                                        Context
                                        Relevance:{" "}
                                        <strong>
                                          {
                                            metrics.context_relevance_score
                                          }
                                        </strong>
                                      </div>

                                      <div
                                        className={`metric-tag ${
                                          highRisk
                                            ? "risk-high"
                                            : "risk-low"
                                        }`}
                                      >
                                        Risk:{" "}
                                        <strong>
                                          {highRisk
                                            ? "High"
                                            : metrics.hallucination_risk}
                                        </strong>
                                      </div>
                                    </div>
                                  </div>
                                )}
                            </div>
                          </details>
                        </div>
                      </div>
                    ) : (
                      <div
                        dir={
                          detectLanguage(
                            message.text
                          ) === "ar"
                            ? "rtl"
                            : "ltr"
                        }
                      >
                        {message.text}
                      </div>
                    )}
                  </div>

                  {/* =========================================
                      SOURCES
                  ========================================= */}

                  {isBot &&
                    message.sources
                      ?.length >
                      0 && (
                      <div className="sources-dropdown-container">
                        <details>
                          <summary className="sources-dropdown-header">
                            📚 Supporting
                            Evidence &
                            Guidelines (
                            {
                              message
                                .sources
                                .length
                            }
                            )
                            <span>
                              ▼
                            </span>
                          </summary>

                          <div className="sources-dropdown-content">
                            {message.sources.map(
                              (
                                source,
                                sourceIndex
                              ) => {
                                const docName =
                                  source
                                    ?.metadata
                                    ?.document_name ||
                                  source
                                    ?.metadata
                                    ?.filename ||
                                  "KDIGO Clinical Guidelines";

                                const pageNum =
                                  source
                                    ?.metadata
                                    ?.page ||
                                  source
                                    ?.metadata
                                    ?.page_number ||
                                  "N/A";

                                const sourceText =
                                  source?.content ||
                                  source?.text ||
                                  "No snippet available.";

                                return (
                                  <div
                                    className="source-item-card"
                                    key={
                                      sourceIndex
                                    }
                                    style={{
                                      display:
                                        "flex",
                                      flexDirection:
                                        "column",
                                      gap:
                                        "4px",
                                    }}
                                  >
                                    <span className="source-tag">
                                      Reference
                                      Item [
                                      {sourceIndex +
                                        1}
                                      ]
                                    </span>

                                    <div className="source-line">
                                      <strong>
                                        document
                                        name:
                                      </strong>{" "}
                                      {
                                        docName
                                      }
                                    </div>

                                    <div className="source-line">
                                      <strong>
                                        page:
                                      </strong>{" "}
                                      {
                                        pageNum
                                      }
                                    </div>

                                    <div className="source-line">
                                      <strong>
                                        source:
                                      </strong>{" "}
                                      "
                                      {
                                        sourceText
                                      }
                                      "
                                    </div>
                                  </div>
                                );
                              }
                            )}
                          </div>
                        </details>
                      </div>
                    )}
                </div>
              );
            }
          )}

          {/* ===============================================
              LOADING
          =============================================== */}

          {loading && (
            <div
              className="message-row bot-row"
              ref={latestMessageRef}
            >
              <div className="message-bubble bot-bubble">
                <div
                  style={{
                    display: "flex",
                    alignItems:
                      "center",
                    gap: "10px",
                  }}
                >
                  ⏳ Synthesizing
                  clinical guidelines...
                </div>
              </div>
            </div>
          )}
        </div>

        {/* =================================================
            CHAT INPUT
        ================================================= */}

        <form
          onSubmit={handleSubmit}
          className="chat-input-form"
          style={{
            display: "flex",
            alignItems:
              "center",
            gap: "14px",
            background:
              isDarkMode
                ? "rgba(30,41,59,0.95)"
                : "rgba(255,255,255,0.95)",
            backdropFilter:
              "blur(12px)",
            border:
              "1px solid rgba(150,150,150,0.3)",
            padding:
              "12px 20px",
            borderRadius:
              "16px",
            width:
              "calc(100% - 40px)",
            maxWidth:
              "1000px",
            position:
              "absolute",
            bottom: "15px",
            left: "50%",
            transform:
              "translateX(-50%)",
            boxShadow:
              "0 10px 30px rgba(0,0,0,0.3)",
            zIndex: 99,
          }}
        >
          <button
            type="button"
            onClick={
              toggleVoiceInput
            }
            style={{
              background:
                isListening
                  ? "rgba(239,68,68,0.4)"
                  : "rgba(255,255,255,0.2)",
              border:
                isListening
                  ? "2px solid #ef4444"
                  : "1px solid rgba(255,255,255,0.4)",
              cursor:
                "pointer",
              fontSize:
                "1.1rem",
              padding:
                "8px 10px",
              borderRadius:
                "10px",
            }}
            title={
              isListening
                ? "Listening... Click to stop"
                : "Voice Input"
            }
          >
            {isListening
              ? "🔴"
              : "🎙️"}
          </button>

          <input
            type="text"
            value={input}
            onChange={(e) =>
              setInput(
                e.target.value
              )
            }
            placeholder={
              isListening
                ? "Listening to your voice..."
                : "Ask about CKD management, KDIGO staging, prescriptions..."
            }
            disabled={loading}
            style={{
              flex: 1,
              background:
                "transparent",
              border: "none",
              color:
                "inherit",
              fontSize:
                "1rem",
              outline:
                "none",
            }}
          />

          <button
            type="submit"
            disabled={
              loading ||
              !input.trim()
            }
            style={{
              padding:
                "8px 18px",
              borderRadius:
                "10px",
              border:
                "none",
              fontWeight:
                "bold",
              cursor:
                loading ||
                !input.trim()
                  ? "not-allowed"
                  : "pointer",
              background:
                "#0284c7",
              color:
                "#fff",
              opacity:
                loading ||
                !input.trim()
                  ? 0.6
                  : 1,
            }}
          >
            Send 🚀
          </button>
        </form>
      </main>
    </div>
  );
}