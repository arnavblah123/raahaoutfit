import { StockUploader } from '@/components/admin/StockUploader';

export default function Stock() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">My stock</h1>
      <p className="text-sm text-muted">Add your own outfits in bulk. Group up to four photos per outfit; the first photo is read for attributes and every photo is embedded.</p>
      <StockUploader />
    </div>
  );
}
