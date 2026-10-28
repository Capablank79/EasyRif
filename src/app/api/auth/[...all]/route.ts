import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/platform/auth";

export const GET = (req: Request) => toNextJsHandler(getAuth()).GET(req);
export const POST = (req: Request) => toNextJsHandler(getAuth()).POST(req);
