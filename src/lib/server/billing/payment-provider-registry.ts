import { type PaymentAdapter } from "./payment-adapters";

type PaymentAdapterFactory = () => PaymentAdapter;

let productionPaymentProviderFactory: PaymentAdapterFactory | null = null;

export function registerProductionPaymentProvider(factory: PaymentAdapterFactory) {
  productionPaymentProviderFactory = factory;
  return () => {
    if (productionPaymentProviderFactory === factory) productionPaymentProviderFactory = null;
  };
}

export function hasProductionPaymentProvider() {
  return Boolean(productionPaymentProviderFactory);
}

export function getRegisteredProductionPaymentProvider() {
  return productionPaymentProviderFactory?.() || null;
}
