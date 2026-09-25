import type { Metadata } from "next";
import GuestJoin from "@/components/meetings/guest-join";

/**
 * A guest's meeting page. Outside the CRM entirely: no workspace, no
 * session, no navigation — just this one meeting, reached through the
 * link's token (checked on the server for every step).
 */
export const metadata: Metadata = {
  title: "Enercore Meeting",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function MeetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <GuestJoin token={token} />;
}
