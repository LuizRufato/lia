export interface CopyFactSheet {
  title: string;
  priceCents: number;
  originalPriceCents: number | null;
  currency: string;
  locale: string;
  discountPercentage: number | null;
  couponCode: string | null;
  freeShipping: boolean | null;
  finalLink: string;
}

export class CopyEngine {
  static generate(facts: CopyFactSheet): string {
    const formatter = new Intl.NumberFormat(facts.locale, {
      style: "currency",
      currency: facts.currency,
    });

    const priceFormatted = formatter.format(facts.priceCents / 100);

    let copy = `🔥 ${facts.title}\n\n`;

    if (
      facts.originalPriceCents !== null &&
      facts.originalPriceCents > facts.priceCents
    ) {
      const originalFormatted = formatter.format(
        facts.originalPriceCents / 100,
      );
      copy += `De: ~${originalFormatted}~\n`;
    }

    copy += `Por: **${priceFormatted}**\n\n`;

    if (facts.discountPercentage !== null) {
      copy += `🎯 Desconto: ${facts.discountPercentage}%\n`;
    }

    if (facts.couponCode !== null) {
      copy += `🎟️ Cupom: ${facts.couponCode}\n`;
    }

    if (facts.freeShipping === true) {
      copy += `🚚 Frete Grátis!\n`;
    }

    copy += `\n🛒 Compre aqui: ${facts.finalLink}`;

    return copy;
  }
}
