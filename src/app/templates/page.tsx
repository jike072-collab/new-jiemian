import { Suspense } from "react";

import { PageReveal } from "@/components/motion";
import { TemplateCenterView } from "@/components/template-center";

export default function TemplatesPage() {
  return (
    <Suspense fallback={null}>
      <PageReveal>
        <TemplateCenterView />
      </PageReveal>
    </Suspense>
  );
}
