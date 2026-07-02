import { Suspense } from "react";

import { PageReveal } from "@/components/motion";
import { TemplateCenterView } from "@/components/template-center";
import { WorkbenchLoadingShell } from "@/components/workbench-loading";

export default function TemplatesPage() {
  return (
    <Suspense fallback={<WorkbenchLoadingShell toolTitle="模板中心" previewTitle="模板浏览" />}>
      <PageReveal>
        <TemplateCenterView />
      </PageReveal>
    </Suspense>
  );
}
