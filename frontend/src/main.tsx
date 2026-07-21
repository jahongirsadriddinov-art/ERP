
  import { createRoot } from "react-dom/client";
  import { MotionConfig } from "motion/react";
  import App from "./app/App.tsx";
  import "./styles/index.css";

  // reducedMotion="user" — OS darajasidagi "Reduce motion" sozlamasini
  // hurmat qiladi (barcha motion/react animatsiyalari uchun, ilova bo'ylab).
  createRoot(document.getElementById("root")!).render(
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  );
