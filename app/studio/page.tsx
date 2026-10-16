import type { Metadata } from "next";
import { StudioConsole } from "../components/StudioConsole";

export const metadata: Metadata = {
  title: "Studio view · Room Booking Assistant",
};

export default function StudioPage() {
  return <StudioConsole />;
}
