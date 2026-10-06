import type { Contribution, ForestModel } from './isolationForest';
import { stripFeatureSuffix } from './features';
import { es } from '../i18n/es';

export interface ExplainedContribution {
  field: string;
  message: string;
  deviation: number;
}

export function explainContribution(model: ForestModel, c: Contribution): ExplainedContribution {
  const name = model.columns[c.featureIndex];
  const field = stripFeatureSuffix(name);
  switch (c.kind) {
    case 'coherence':
      return { field, deviation: c.deviation, message: es.mlCoherence(field, c.value, c.expected ?? NaN) };
    case 'missing':
      return { field, deviation: c.deviation, message: es.mlMissing(field, model.indicatorRate[c.featureIndex]) };
    case 'rarity':
      return { field, deviation: c.deviation, message: es.mlRarity(field, Math.exp(-c.value)) };
    case 'date':
      return { field, deviation: c.deviation, message: es.mlValue(field, c.value, model.median[c.featureIndex], c.deviation, 'date') };
    default: {
      const ref = model.log[c.featureIndex] ? Math.exp(model.median[c.featureIndex]) : model.median[c.featureIndex];
      return { field, deviation: c.deviation, message: es.mlValue(field, c.value, ref, c.deviation, 'numeric') };
    }
  }
}
