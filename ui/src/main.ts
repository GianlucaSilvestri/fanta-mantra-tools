import "./index.css";
import { bootLocale } from "./locale";

await bootLocale();
await import("./components/app-root");
