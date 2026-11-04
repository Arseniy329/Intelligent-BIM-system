import { DrawingDetail } from "@/components/drawing/drawing-detail";

export default async function DrawingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DrawingDetail key={id} id={id} />;
}
