import { Suspense } from "react";

import { ApplicationContainer } from "@/components/application-container";
import { WorkbenchLoadingShell } from "@/components/workbench-loading";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Home() {
  return (
    <Suspense fallback={<WorkbenchLoadingShell />}>
      <ApplicationContainer />
    </Suspense>
  );
}
