import { DrawingDetailRoute } from "./drawing-detail-route";

type DrawingPageParams = Promise<{ id: string }> | { id: string };

export default async function DrawingPage({
  params,
}: {
  params: DrawingPageParams;
}) {
  const { id } = await params;
  return <DrawingDetailRoute key={id} id={id} />;
}
