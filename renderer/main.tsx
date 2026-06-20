import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./picture-in-picture.css";
import App from "./app";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
