import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AutocompleteInput } from '@/components/ui/AutocompleteInput';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconPlus, IconX } from '@/components/ui/icons';
import { IconArrowDown, IconArrowUp } from '@/components/proxx/icons';
import { ProxxSegmented } from '@/components/proxx/ProxxPage';
import ui from '@/components/proxx/ProxxPage.module.scss';
import { MODEL_GROUP_STRATEGIES, moveItem, validateModelGroup } from '@/services/api/proxxGroups';
import type { ModelGroupConfig } from '@/types/proxx';
import styles from '../ModelGroupsPage.module.scss';

interface GroupEditorModalProps {
  open: boolean;
  initial: ModelGroupConfig | null;
  others: ModelGroupConfig[];
  modelOptions: string[];
  saving: boolean;
  onClose: () => void;
  onSave: (group: ModelGroupConfig) => void;
}

const emptyGroup = (): ModelGroupConfig => ({
  name: '',
  strategy: 'ordered',
  models: [],
  hidden: false,
});

export function GroupEditorModal({
  open,
  initial,
  others,
  modelOptions,
  saving,
  onClose,
  onSave,
}: GroupEditorModalProps) {
  const { t } = useTranslation();
  const formId = useId();
  const [draft, setDraft] = useState<ModelGroupConfig>(emptyGroup);
  const [candidate, setCandidate] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(initial ? { ...initial, models: initial.models.slice() } : emptyGroup());
    setCandidate('');
    setSubmitted(false);
  }, [open, initial]);

  const error = validateModelGroup(draft, others);
  const pickerOptions = useMemo(() => {
    const taken = new Set(draft.models.map((model) => model.toLowerCase()));
    const self = draft.name.trim().toLowerCase();
    return modelOptions.filter(
      (model) => !taken.has(model.toLowerCase()) && model.toLowerCase() !== self
    );
  }, [draft.models, draft.name, modelOptions]);

  const addCandidate = () => {
    const model = candidate.trim();
    if (!model) return;
    if (!draft.models.some((existing) => existing.toLowerCase() === model.toLowerCase())) {
      setDraft((current) => ({ ...current, models: [...current.models, model] }));
    }
    setCandidate('');
  };

  const handleSubmit = (event?: FormEvent) => {
    event?.preventDefault();
    setSubmitted(true);
    if (error) return;
    onSave({ ...draft, name: draft.name.trim() });
  };

  const nameError =
    submitted && error && error.startsWith('name') ? t(`proxx.groups.error.${error}`) : undefined;

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeDisabled={saving}
      width={600}
      title={
        initial ? t('proxx.groups.edit_title', { name: initial.name }) : t('proxx.groups.add_title')
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={formId} loading={saving}>
            {t('proxx.common.save')}
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.editor} onSubmit={handleSubmit}>
        <Input
          label={t('proxx.groups.field_name')}
          value={draft.name}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          placeholder="auto"
          hint={t('proxx.groups.field_name_hint')}
          error={nameError}
          autoFocus
          spellCheck={false}
          autoComplete="off"
        />

        <div className={styles.editorRow}>
          <div className={styles.editorField}>
            <span className={styles.editorLabel}>{t('proxx.groups.field_strategy')}</span>
            <ProxxSegmented
              value={draft.strategy}
              options={MODEL_GROUP_STRATEGIES.map((strategy) => ({
                value: strategy,
                label: t(`proxx.groups.strategy.${strategy}`),
              }))}
              onChange={(strategy) => setDraft((current) => ({ ...current, strategy }))}
              ariaLabel={t('proxx.groups.field_strategy')}
            />
            <span className={styles.editorHint}>
              {t(`proxx.groups.strategy_hint.${draft.strategy}`)}
            </span>
          </div>
          <div className={styles.editorField}>
            <span className={styles.editorLabel}>{t('proxx.groups.field_hidden')}</span>
            <ToggleSwitch
              checked={draft.hidden}
              onChange={(hidden) => setDraft((current) => ({ ...current, hidden }))}
              label={t('proxx.groups.field_hidden_label')}
            />
          </div>
        </div>

        <div className={styles.editorField}>
          <span className={styles.editorLabel}>
            {t('proxx.groups.field_members')}
            <span className={ui.muted}> · {t('proxx.groups.field_members_hint')}</span>
          </span>
          <ol className={styles.memberEditList}>
            {draft.models.length === 0 ? (
              <li className={styles.memberEditEmpty}>{t('proxx.groups.no_members')}</li>
            ) : (
              draft.models.map((model, index) => (
                <li key={model} className={styles.memberEditRow}>
                  <span className={styles.memberIndex}>{index + 1}</span>
                  <span className={`${ui.mono} ${styles.memberEditName}`}>{model}</span>
                  <button
                    type="button"
                    className={ui.iconButton}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        models: moveItem(current.models, index, -1),
                      }))
                    }
                    disabled={index === 0}
                    aria-label={t('proxx.groups.move_up', { model })}
                  >
                    <IconArrowUp />
                  </button>
                  <button
                    type="button"
                    className={ui.iconButton}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        models: moveItem(current.models, index, 1),
                      }))
                    }
                    disabled={index === draft.models.length - 1}
                    aria-label={t('proxx.groups.move_down', { model })}
                  >
                    <IconArrowDown />
                  </button>
                  <button
                    type="button"
                    className={ui.iconButton}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        models: current.models.filter((_, i) => i !== index),
                      }))
                    }
                    aria-label={t('proxx.groups.remove_member', { model })}
                  >
                    <IconX />
                  </button>
                </li>
              ))
            )}
          </ol>
          <div
            className={styles.memberAdd}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.defaultPrevented && candidate.trim()) {
                event.preventDefault();
                addCandidate();
              }
            }}
          >
            <AutocompleteInput
              value={candidate}
              onChange={setCandidate}
              options={pickerOptions}
              placeholder={t('proxx.groups.add_member_placeholder')}
              wrapperClassName={styles.memberAddInput}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={addCandidate}
              disabled={!candidate.trim()}
            >
              <IconPlus size={14} />
              {t('proxx.groups.add_member')}
            </Button>
          </div>
          {submitted && error && !error.startsWith('name') ? (
            <span className={styles.editorError} role="alert">
              {t(`proxx.groups.error.${error}`)}
            </span>
          ) : null}
        </div>
      </form>
    </Modal>
  );
}
