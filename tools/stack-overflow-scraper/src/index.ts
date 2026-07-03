import { defineTool, type Bf } from "@better-fetch/tools";

type Mode = "search" | "answers";

type Input = {
  mode?: Mode;
  query?: string;
  tagged?: string;
  site?: string;
  sort?: "relevance" | "activity" | "creation" | "votes";
  question_ids?: string;
  include_answers?: boolean;
  max_results?: number;
  max_answers_per_question?: number;
};

type StackOwner = {
  display_name?: string;
  link?: string;
  reputation?: number;
  user_id?: number;
};

type StackQuestion = {
  question_id?: number;
  title?: string;
  link?: string;
  tags?: string[];
  score?: number;
  view_count?: number;
  answer_count?: number;
  is_answered?: boolean;
  accepted_answer_id?: number;
  creation_date?: number;
  last_activity_date?: number;
  body?: string;
  content_license?: string;
  owner?: StackOwner;
};

type StackAnswer = {
  answer_id?: number;
  question_id?: number;
  is_accepted?: boolean;
  score?: number;
  creation_date?: number;
  last_activity_date?: number;
  body?: string;
  content_license?: string;
  owner?: StackOwner;
};

type StackResponse<T> = {
  items?: T[];
  has_more?: boolean;
  quota_remaining?: number;
  error_message?: string;
};

type QuestionRecord = {
  type: "question";
  question_id: number;
  title: string;
  url?: string;
  tags?: string;
  score?: number;
  view_count?: number;
  answer_count?: number;
  is_answered?: boolean;
  accepted_answer_id?: number;
  created_at?: string;
  last_activity_at?: string;
  owner_name?: string;
  owner_url?: string;
  owner_reputation?: number;
  body_text?: string;
  content_license?: string;
};

type AnswerRecord = {
  type: "answer";
  answer_id: number;
  question_id: number;
  url?: string;
  is_accepted?: boolean;
  score?: number;
  created_at?: string;
  last_activity_at?: string;
  owner_name?: string;
  owner_url?: string;
  owner_reputation?: number;
  body_text?: string;
  content_license?: string;
};

type Output = {
  mode: Mode;
  site: string;
  source_url: string;
  count: number;
  answer_count?: number;
  quota_remaining?: number;
  questions?: QuestionRecord[];
  answers?: AnswerRecord[];
};

function cleanSite(value: string | undefined): string {
  const clean = value?.trim().toLowerCase() || "stackoverflow";
  return /^[a-z0-9_.-]{2,40}$/.test(clean) ? clean : "stackoverflow";
}

function cleanSort(value: Input["sort"]): "relevance" | "activity" | "creation" | "votes" {
  return value === "activity" || value === "creation" || value === "votes" ? value : "relevance";
}

function limitFrom(value: number | undefined, fallback: number, max: number): number {
  return Math.min(Math.max(value ?? fallback, 1), max);
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function htmlToText(value: string | undefined): string | undefined {
  const clean = decodeEntities((value ?? "").replace(/<pre><code>/gi, " ").replace(/<\/code><\/pre>/gi, " ").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return clean || undefined;
}

function isoFromUnix(value: number | undefined): string | undefined {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000).toISOString() : undefined;
}

function intValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined;
}

function boolValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function compact<T extends Record<string, unknown>>(record: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out as T;
}

function questionFromApi(item: StackQuestion): QuestionRecord | undefined {
  const questionId = intValue(item.question_id);
  const title = htmlToText(item.title);
  if (!questionId || !title) return undefined;
  return compact({
    type: "question",
    question_id: questionId,
    title,
    url: item.link,
    tags: item.tags?.join(", "),
    score: intValue(item.score),
    view_count: intValue(item.view_count),
    answer_count: intValue(item.answer_count),
    is_answered: boolValue(item.is_answered),
    accepted_answer_id: intValue(item.accepted_answer_id),
    created_at: isoFromUnix(item.creation_date),
    last_activity_at: isoFromUnix(item.last_activity_date),
    owner_name: htmlToText(item.owner?.display_name),
    owner_url: item.owner?.link,
    owner_reputation: intValue(item.owner?.reputation),
    body_text: htmlToText(item.body),
    content_license: item.content_license,
  });
}

function answerFromApi(item: StackAnswer): AnswerRecord | undefined {
  const answerId = intValue(item.answer_id);
  const questionId = intValue(item.question_id);
  if (!answerId || !questionId) return undefined;
  return compact({
    type: "answer",
    answer_id: answerId,
    question_id: questionId,
    url: `https://stackoverflow.com/a/${answerId}`,
    is_accepted: boolValue(item.is_accepted),
    score: intValue(item.score),
    created_at: isoFromUnix(item.creation_date),
    last_activity_at: isoFromUnix(item.last_activity_date),
    owner_name: htmlToText(item.owner?.display_name),
    owner_url: item.owner?.link,
    owner_reputation: intValue(item.owner?.reputation),
    body_text: htmlToText(item.body),
    content_license: item.content_license,
  });
}

function parseQuestionIds(value: string | undefined): string {
  const ids = (value ?? "")
    .split(/[;,\s]+/)
    .map((part) => part.trim())
    .filter((part) => /^\d+$/.test(part))
    .slice(0, 20);
  if (!ids.length) throw new Error("question_ids must include at least one numeric Stack Overflow question id");
  return ids.join(";");
}

function apiUrl(path: string, params: Record<string, string>): string {
  const search = Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  return `https://api.stackexchange.com/2.3${path}?${search}`;
}

async function fetchStack<T>(bf: Bf, url: string): Promise<StackResponse<T>> {
  const response = await bf.fetch({
    url,
    strategy: "http",
    return_response_text: true,
    extra_headers: {
      accept: "application/json,*/*;q=0.5",
      "user-agent": "BetterFetchStackOverflowScraper/0.1 (+https://betterfetch.co/tools/stack_overflow_scraper)",
    },
  });
  if (response.status && response.status >= 400) {
    throw new Error(`Stack Exchange API request failed with HTTP ${response.status}`);
  }
  let payload: StackResponse<T>;
  try {
    payload = JSON.parse(response.body_text ?? "") as StackResponse<T>;
  } catch {
    throw new Error("Stack Exchange API returned invalid JSON");
  }
  if (payload.error_message) throw new Error(payload.error_message);
  return payload;
}

async function fetchAnswers(bf: Bf, site: string, ids: string, maxAnswers: number): Promise<{ url: string; payload: StackResponse<StackAnswer> }> {
  const url = apiUrl(`/questions/${encodeURIComponent(ids)}/answers`, {
    order: "desc",
    sort: "votes",
    site,
    pagesize: String(maxAnswers),
    filter: "withbody",
  });
  return { url, payload: await fetchStack<StackAnswer>(bf, url) };
}

export default defineTool<Input, Output>(async (input, bf) => {
  const mode = input.mode ?? "search";
  const site = cleanSite(input.site);
  const maxResults = limitFrom(input.max_results, 5, 20);
  const maxAnswers = limitFrom(input.max_answers_per_question, 1, 5);

  if (mode === "answers") {
    const ids = parseQuestionIds(input.question_ids);
    const { url, payload } = await fetchAnswers(bf, site, ids, maxAnswers * ids.split(";").length);
    const answers = (payload.items ?? []).map(answerFromApi).filter((answer): answer is AnswerRecord => Boolean(answer));
    if (!answers.length) throw new Error("No Stack Overflow answers were found for these question ids");
    return {
      mode,
      site,
      source_url: url,
      count: answers.length,
      quota_remaining: payload.quota_remaining,
      answers,
    };
  }

  const query = input.query?.trim();
  const tagged = input.tagged?.trim();
  if (!query && !tagged) throw new Error("query or tagged is required for search mode");
  const params: Record<string, string> = {
    order: "desc",
    sort: cleanSort(input.sort),
    site,
    pagesize: String(maxResults),
    filter: "withbody",
  };
  if (query) params.q = query;
  if (tagged) params.tagged = tagged.split(/[,\s;]+/).filter(Boolean).slice(0, 5).join(";");
  const url = apiUrl("/search/advanced", params);
  const payload = await fetchStack<StackQuestion>(bf, url);
  const questions = (payload.items ?? []).map(questionFromApi).filter((question): question is QuestionRecord => Boolean(question)).slice(0, maxResults);
  if (!questions.length) throw new Error("No Stack Overflow questions were found for this search");

  let answers: AnswerRecord[] = [];
  if (input.include_answers) {
    const ids = questions.map((question) => String(question.question_id)).join(";");
    const answerPayload = await fetchAnswers(bf, site, ids, maxAnswers * questions.length);
    answers = (answerPayload.payload.items ?? []).map(answerFromApi).filter((answer): answer is AnswerRecord => Boolean(answer));
  }

  return compact({
    mode,
    site,
    source_url: url,
    count: questions.length,
    answer_count: answers.length || undefined,
    quota_remaining: payload.quota_remaining,
    questions,
    answers: answers.length ? answers : undefined,
  });
});
