import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import AccessBoundary from "./AccessBoundary";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./index.css";
createRoot(document.getElementById("root")!).render(<StrictMode><AccessBoundary><App /></AccessBoundary></StrictMode>);
