import * as React from 'react';
import { View, StyleSheet, ScrollView, Platform, Pressable, Text } from 'react-native';
import { ToolSectionView } from '../../tools/ToolSectionView';
import { ToolViewProps } from './_all';
import { DiffView } from '@/components/diff/DiffView';
import { knownTools } from '../../tools/knownTools';
import { trimIdent } from '@/utils/trimIdent';
import { useSetting } from '@/sync/storage';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';

export const MultiEditView = React.memo<ToolViewProps>(({ tool }) => {
    const { theme } = useUnistyles();
    const showLineNumbersInToolViews = useSetting('showLineNumbersInToolViews');
    const wrapLinesInDiffs = useSetting('wrapLinesInDiffs');
    const defaultCollapsed = Platform.OS === 'web';
    const [expanded, setExpanded] = React.useState(!defaultCollapsed);
    
    let edits: Array<{ old_string: string; new_string: string; replace_all?: boolean }> = [];
    
    const parsed = knownTools.MultiEdit.input.safeParse(tool.input);
    if (parsed.success && parsed.data.edits) {
        edits = parsed.data.edits;
    }

    React.useEffect(() => {
        setExpanded(!defaultCollapsed);
    }, [defaultCollapsed, tool.createdAt]);

    if (edits.length === 0) {
        return null;
    }

    const toggle = (
        <Pressable
            onPress={() => setExpanded((v) => !v)}
            style={({ pressed }) => [
                styles.toggle,
                {
                    backgroundColor: theme.colors.surfaceHigh,
                    borderColor: theme.colors.divider,
                },
                { opacity: pressed ? 0.7 : 1 }
            ]}
        >
            <Text style={[styles.toggleText, { color: theme.colors.textSecondary }]}>
                {expanded ? 'Hide changes' : 'Show changes'}
            </Text>
            <Ionicons
                name={expanded ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={theme.colors.textSecondary}
            />
        </Pressable>
    );

    if (!expanded) {
        return (
            <ToolSectionView fullWidth>
                {toggle}
            </ToolSectionView>
        );
    }

    const content = (
        <View style={{ flex: 1 }}>
            {edits.map((edit, index) => {
                const oldString = trimIdent(edit.old_string || '');
                const newString = trimIdent(edit.new_string || '');
                
                return (
                    <View key={index}>
                        <DiffView 
                            oldText={oldString} 
                            newText={newString} 
                            wrapLines={wrapLinesInDiffs}
                            showLineNumbers={showLineNumbersInToolViews}
                            showPlusMinusSymbols={showLineNumbersInToolViews}
                        />
                        {index < edits.length - 1 && <View style={styles.separator} />}
                    </View>
                );
            })}
        </View>
    );

    if (wrapLinesInDiffs) {
        // When wrapping lines, no horizontal scroll needed
        return (
            <ToolSectionView fullWidth>
                {toggle}
                {content}
            </ToolSectionView>
        );
    }

    // When not wrapping, use horizontal scroll
    return (
        <ToolSectionView fullWidth>
            {toggle}
            <ScrollView 
                horizontal 
                showsHorizontalScrollIndicator={true}
                showsVerticalScrollIndicator={true}
                nestedScrollEnabled={true}
                contentContainerStyle={{ flexGrow: 1 }}
            >
                {content}
            </ScrollView>
        </ToolSectionView>
    );
});

const styles = StyleSheet.create({
    toggle: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginHorizontal: 12,
        marginBottom: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 8,
        borderWidth: 1,
    },
    toggleText: {
        fontSize: 13,
        fontWeight: '500',
    },
    separator: {
        height: 8,
    },
});
