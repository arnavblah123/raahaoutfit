import { Labeller } from '@/components/admin/Labeller';
import { labelCounts } from '../../actions';

export default async function LabelPage() {
  return <Labeller initialCounts={await labelCounts()} />;
}
