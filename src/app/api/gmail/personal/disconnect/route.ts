import { disconnectPersonalGmail } from "@/lib/gmail/personal-connection";
export const dynamic = "force-dynamic";
export async function POST(req: Request) { return disconnectPersonalGmail(req); }
