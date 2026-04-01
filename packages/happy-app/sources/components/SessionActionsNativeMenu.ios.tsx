import * as React from 'react';
import { Button, ContextMenu, Host, type ButtonProps as SwiftButtonProps } from '@expo/ui/swift-ui';
import { useSessionQuickActions } from '@/hooks/useSessionQuickActions';
import { Session } from '@/sync/storageTypes';
import { t } from '@/text';

interface SessionActionsNativeMenuProps {
    children: React.ReactNode;
    onAfterArchive?: () => void;
    onAfterDelete?: () => void;
    session: Session;
}

const iosSymbol = (name: string) =>
    name as unknown as React.ComponentProps<typeof Button>['systemImage'];

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

    const items: Array<React.ReactElement<SwiftButtonProps>> = [
        <Button key="details" onPress={openDetails} systemImage={iosSymbol('info.circle')}>Details</Button>,
        canArchive ? <Button key="archive" onPress={archiveSession} systemImage={iosSymbol('archivebox')}>Archive</Button> : null,
        canShowResume ? <Button key="resume" onPress={resumeSession} systemImage={iosSymbol('play.circle')}>Resume</Button> : null,
        canCopySessionMetadata ? <Button key="copy" onPress={copySessionMetadata} systemImage={iosSymbol('ladybug')}>{t('sessionInfo.copyMetadata')}</Button> : null,
    ].filter((item): item is React.ReactElement<SwiftButtonProps> => item !== null);

    return (
        <Host matchContents>
            <ContextMenu>
                <ContextMenu.Items>
                    {items}
                </ContextMenu.Items>
                <ContextMenu.Trigger>{children}</ContextMenu.Trigger>
            </ContextMenu>
        </Host>
    );
}
