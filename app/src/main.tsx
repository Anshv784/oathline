import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Notice } from "./components/ui";
import { Developers } from "./pages/Developers";
import { How } from "./pages/How";
import { Ledger } from "./pages/Ledger";
import { Markets } from "./pages/Markets";
import { Models } from "./pages/Models";
import { VerdictPage } from "./pages/VerdictPage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Ledger />} />
          <Route path="v/:id" element={<VerdictPage />} />
          <Route path="models" element={<Models />} />
          <Route path="how" element={<How />} />
          <Route path="developers" element={<Developers />} />
          <Route path="markets" element={<Markets />} />
          <Route path="*" element={<Notice title="This page doesn't exist" />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
