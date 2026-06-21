import { Suspense } from "react";

import { TemplateCenterView } from "@/components/template-center";

export default function TemplatesPage() {
  return (
    <Suspense fallback={null}>
      <TemplateCenterView />
    </Suspense>
  );
}
