import { defineTool } from "@better-fetch/tools";

type Input = {
  handle: string;
  region?: "US" | "us";
  cursor?: string;
};

type ShowcaseProduct = {
  product_id: string;
  title: string;
  url: string;
  image_url?: string;
  price?: string;
  original_price?: string;
  currency?: string;
  discount?: string;
  rating?: number;
  review_count?: number;
  sold_count?: number;
  seller_id?: string;
  sku_id?: string;
};

type Output = {
  handle: string;
  region: "US";
  source_url: string;
  source_type: "managed_upstream";
  count: number;
  products: ShowcaseProduct[];
  has_more: boolean;
  cursor?: string;
};

export default defineTool(async (input: Input, bf): Promise<Output> => {
  const handle = input.handle?.trim().replace(/^@/, "");
  if (!handle || !/^[A-Za-z0-9._]{2,30}$/.test(handle)) {
    throw new Error("handle must be a valid TikTok creator handle");
  }
  const region = input.region?.toUpperCase() || "US";
  if (region !== "US") throw new Error("TikTok Shop showcase support currently requires region US");
  const cursor = input.cursor?.trim();
  if (cursor !== undefined && (!cursor || cursor.length > 512)) {
    throw new Error("cursor must be a non-empty string of at most 512 characters");
  }

  // The intersection keeps local validation compatible until SDK 0.5.0 is
  // published; the hosted runner supplies this metered capability.
  const managedBf = bf as typeof bf & {
    tiktokShopShowcase(payload: Input): Promise<Output>;
  };
  return managedBf.tiktokShopShowcase({
    handle,
    region: "US",
    ...(cursor ? { cursor } : {}),
  });
});
