import { Gift, ShoppingBag } from "lucide-react";

import { GIFT_EMPTY_TEXT, giftContentLabel } from "../model/gifts";
import { formatCents } from "../model/format";
import type { GiftsController } from "../controllers/useGiftsController";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "./components/memberBits";

/**
 * 礼包超市页（/member/gifts，WP-M15）：配置驱动货架。
 * 本期后端无礼包下单接口，购买按钮固定禁用「即将上线」。
 */
export function GiftPackView({ controller }: { controller: GiftsController }) {
  if (controller.isPending) return <LoadingBlock text="正在读取礼包货架…" />;
  if (controller.isError) return <ErrorBlock onRetry={controller.reload} />;
  if (controller.gifts.length === 0) {
    return <EmptyBlock text={GIFT_EMPTY_TEXT} hint="货架由运营在后台「套餐配置 → gift_packs」维护" />;
  }

  return (
    <div className="member-stack">
      <p className="member-tip">
        <Gift size={13} /> 礼包由平台限时上架，价格和内容以后台配置为准。
      </p>
      <div className="member-gift-grid">
        {controller.gifts.map(pack => (
          <article className="member-card member-gift" key={pack.id}>
            {pack.cover ? (
              <img className="member-gift-cover" src={pack.cover} alt={pack.name} loading="lazy" />
            ) : (
              <div className="member-gift-cover member-gift-cover-placeholder" aria-hidden="true">
                <ShoppingBag size={26} />
              </div>
            )}
            <div className="member-gift-body">
              <h4>{pack.name}</h4>
              {pack.description ? <p>{pack.description}</p> : null}
              <div className="member-gift-meta">
                <b className="member-gift-price">{formatCents(pack.price_cents)}</b>
                <small>{giftContentLabel(pack)}</small>
              </div>
              <button type="button" className="create-button member-gift-buy" disabled title="本期暂未开放礼包下单">
                即将上线
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
