import { Suspense } from "react";

import { ApplicationContainer } from "@/components/application-container";

export default function Home() {
  return (
    <Suspense fallback={null}>
      <ApplicationContainer />
    </Suspense>
  );
}
