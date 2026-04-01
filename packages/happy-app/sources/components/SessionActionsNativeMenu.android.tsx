import * as React from 'react';
import { Button, ContextMenu, type ButtonProps as JetpackButtonProps } from '@expo/ui/jetpack-compose';
import { useSessionQuickActions } from '@/hooks/useSessionQuickActions';
import { Session } from '@/sync/storageTypes';
import { t } from '@/text';

interface SessionActionsNativeMenuProps {
    children: React.ReactNode;
    onAfterArchive?: () => void;
    onAfterDelete?: () => void;
    session: Session;
}

export function SessionActionsNativeMenu({
    children,
    onAfterArchive,
    onAfterDelete,
    session,
}: SessionActionsNativeMenuProps) {
    const {
        archiveSession,
        canArchive,
        canCopySessionMetadata,
        canShowResume,
        copySessionMetadata,
        openDetails,
        resumeSession,
    } = useSessionQuickActions(session, {
        onAfterArchive,
        onAfterDelete,
    });

    const items: Array<React.ReactElement<JetpackButtonProps>> = [
        <Button key="details" onPress={openDetails}>Details</Button>,
        canArchive ? <Button key="archive" onPress={archiveSession}>Archive</Button> : null,
        canShowResume ? <Button key="resume" onPress={resumeSession}>Resume</Button> : null,
        canCopySessionMetadata ? <Button key="copy" onPress={copySessionMetadata}>{t('sessionInfo.copyMetadata')}</Button> : null,
    ].filter((item): item is React.ReactElement<JetpackButtonProps> => item !== null);

    return (
        <ContextMenu>
            <ContextMenu.Items>
                {items}
            </ContextMenu.Items>
            <ContextMenu.Trigger>{children}</ContextMenu.Trigger>
        </ContextMenu>
    );
}
