/**
 * Thin Bot API calls for forum topics. Telegraf's typings may lag behind Bot API;
 * these use HTTPS JSON POSTs to api.telegram.org.
 */

import * as https from "https";

type ApiOk<T> = { ok: true; result: T };
type ApiErr = { ok: false; description?: string };
type TopicCreateResult = { message_thread_id: number };
type FindExistingThreadId = () => Promise<number | null>;
const topicCreateInFlight = new Map<string, Promise<TopicCreateResult>>();

function postJson<R>(path: string, body: object): Promise<R> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        hostname: "api.telegram.org",
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          try {
            resolve(JSON.parse(raw) as R);
          } catch (e) {
            reject(new Error(`Invalid JSON from Telegram: ${raw.slice(0, 200)}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

export async function createForumTopic(
  token: string,
  chatId: number,
  name: string,
): Promise<{ message_thread_id: number }> {
  const path = `/bot${token}/createForumTopic`;
  const res = await postJson<ApiOk<{ message_thread_id: number }> | ApiErr>(
    path,
    { chat_id: chatId, name },
  );
  if (!res.ok) {
    throw new Error(res.description ?? "createForumTopic failed");
  }
  return { message_thread_id: res.result.message_thread_id };
}

export async function createForumTopicIdempotent(input: {
  token: string;
  chatId: number;
  name: string;
  consultationId: string;
  findExistingThreadId: FindExistingThreadId;
}): Promise<TopicCreateResult> {
  const existing = await input.findExistingThreadId();
  if (existing != null) {
    return { message_thread_id: existing };
  }

  const lockKey = `${input.chatId}:${input.consultationId}`;
  const inFlight = topicCreateInFlight.get(lockKey);
  if (inFlight) {
    return inFlight;
  }

  const task = (async (): Promise<TopicCreateResult> => {
    const retryExisting = await input.findExistingThreadId();
    if (retryExisting != null) {
      return { message_thread_id: retryExisting };
    }
    return createForumTopic(input.token, input.chatId, input.name);
  })();

  topicCreateInFlight.set(lockKey, task);
  try {
    return await task;
  } finally {
    topicCreateInFlight.delete(lockKey);
  }
}

export async function editForumTopic(
  token: string,
  chatId: number,
  messageThreadId: number,
  name: string,
): Promise<void> {
  const path = `/bot${token}/editForumTopic`;
  const res = await postJson<ApiOk<unknown> | ApiErr>(path, {
    chat_id: chatId,
    message_thread_id: messageThreadId,
    name,
  });
  if (!res.ok) {
    throw new Error((res as ApiErr).description ?? "editForumTopic failed");
  }
}

export async function sendMessageInTopic(
  token: string,
  chatId: number,
  messageThreadId: number,
  text: string,
): Promise<void> {
  const path = `/bot${token}/sendMessage`;
  const res = await postJson<ApiOk<unknown> | ApiErr>(path, {
    chat_id: chatId,
    message_thread_id: messageThreadId,
    text,
  });
  if (!res.ok) {
    throw new Error((res as ApiErr).description ?? "sendMessage failed");
  }
}
