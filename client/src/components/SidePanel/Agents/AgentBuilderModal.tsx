import React from 'react';
import { X } from 'lucide-react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { useLocalize } from '~/hooks';
import AgentConfig from './AgentConfig';

interface AgentBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AgentBuilderModal({ isOpen, onClose }: AgentBuilderModalProps) {
  const localize = useLocalize();

  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-[102]">
      <div className="fixed inset-0 bg-surface-primary opacity-60 transition-opacity dark:opacity-80" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="relative max-h-[90vh] w-full transform overflow-hidden rounded-lg bg-surface-secondary text-left shadow-xl transition-all sm:mx-7 sm:my-8 sm:max-w-3xl">
          <div className="flex items-center justify-between border-b border-border-medium px-6 py-4">
            <DialogTitle className="text-lg font-medium leading-6 text-text-primary">
              {localize('com_sidepanel_agent_builder')}
            </DialogTitle>
            <button
              onClick={onClose}
              className="inline-block rounded-full text-text-secondary transition-colors hover:text-text-primary"
              aria-label="Close dialog"
              type="button"
            >
              <X aria-hidden="true" />
            </button>
          </div>
          <div className="scrollbar-gutter-stable max-h-[calc(90vh-4rem)] overflow-y-auto">
            <AgentConfig />
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
