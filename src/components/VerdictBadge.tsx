import { VERDICT_LABEL } from '@/lib/weddings';

const STYLE: Record<string, string> = {
  same_outfit: 'bg-[#fde9e4] text-[#8c2a12]',
  same_design_diff_colour: 'bg-[#fdeed8] text-[#8a4a0c]',
  similar_look: 'bg-[#fdf3cf] text-[#735a06]',
  possible_clash: 'bg-[#f1ece6] text-[#5d4b3c]',
  no_clash: 'bg-[#e3f3ea] text-[#1f6143]',
};
export function VerdictBadge({ verdict, large }: { verdict: string; large?: boolean }) {
  return (
    <span className={`inline-block rounded-full font-medium ${STYLE[verdict] ?? STYLE.possible_clash} ${large ? 'px-4 py-2 text-lg' : 'px-2.5 py-1 text-xs'}`}>
      {VERDICT_LABEL[verdict] ?? verdict}
    </span>
  );
}
