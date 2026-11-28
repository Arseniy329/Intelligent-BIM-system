import { DrawingReportRoute } from "./drawing-report-route";

type DrawingReportPageParams = Promise<{ id: string }> | { id: string };

export default async function DrawingReportPage({
  params,
}: {
  params: DrawingReportPageParams;
}) {
  const { id } = await params;
  return <DrawingReportRoute key={id} id={id} />;
}
