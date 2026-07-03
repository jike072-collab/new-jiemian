import { type PaymentAdapter } from "./payment-adapters";
import { createZpayPaymentAdapter, isZpayProductionPaymentConfigured } from "./zpay-provider";

type PaymentAdapterFactory = () => PaymentAdapter;

let productionPaymentProviderFactory: PaymentAdapterFactory | null = null;

export function registerProductionPaymentProvider(factory: PaymentAdapterFactory) {
  productionPaymentProviderFactory = factory;
  return () => {
    if (productionPaymentProviderFactory === factory) productionPaymentProviderFactory = null;
  };
}

export function hasProductionPaymentProvider() {
  return Boolean(productionPaymentProviderFactory) || isZpayProductionPaymentConfigured();
}

export function getRegisteredProductionPaymentProvider() {
  return productionPaymentProviderFactory?.()
    || (isZpayProductionPaymentConfigured() ? createZpayPaymentAdapter() : null);
}
