import type { LinkedEntity } from '../api/types';
import './linked-entity-graph.css';

interface Props {
  centerLabel: string;
  entities: LinkedEntity[];
}

/** specs/suites/bfsi/features/aml-detection/screens/03-case-workspace.md:
 * "reuse same graph component on Customer 360" — Customer 360 is
 * Phase 2 and doesn't exist yet, but this is built as a standalone,
 * data-driven component from day one so that screen imports this one
 * rather than growing a second implementation. */
export function LinkedEntityGraph({ centerLabel, entities }: Props) {
  if (entities.length === 0) {
    return <div className="linked-graph__empty">No linked entities.</div>;
  }

  return (
    <div className="linked-graph">
      <div className="linked-graph__center">{centerLabel}</div>
      <div className="linked-graph__edges">
        {entities.map((e) => (
          <div key={e.entity_id} className="linked-graph__node">
            <div className="linked-graph__nodeTitle">{e.entity_id}</div>
            <div className="linked-graph__nodeRel">{e.relationship_type.replace(/_/g, ' ')}</div>
            {e.account_id && <div className="linked-graph__nodeAccount">A/C {e.account_id}</div>}
            {e.notes && <div className="linked-graph__nodeNotes">{e.notes}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
