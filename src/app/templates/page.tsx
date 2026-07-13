import { Suspense } from "react";

import { TemplateCenterView } from "@/components/template-center";
import { WorkbenchLoadingShell } from "@/components/workbench-loading";

export default function TemplatesPage() {
  return (
    <Suspense fallback={<WorkbenchLoadingShell toolTitle="模板中心" previewTitle="模板浏览" />}>
      <TemplateCenterView />
    </Suspense>
  );
}
