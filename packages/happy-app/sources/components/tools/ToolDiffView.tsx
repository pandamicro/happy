import * as React from 'react';
import { ScrollView, View, Pressable, Text, Platform } from 'react-native';
import { DiffView } from '@/components/diff/DiffView';
import { useSetting } from '@/sync/storage';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

interface ToolDiffViewProps {
    oldText: string;
    newText: string;
    style?: any;
    showLineNumbers?: boolean;
    showPlusMinusSymbols?: boolean;
    collapsible?: boolean;
    defaultCollapsed?: boolean;
}

export const ToolDiffView = React.memo<ToolDiffViewProps>(({ 
    oldText, 
    newText, 
    style, 
    showLineNumbers = false,
    showPlusMinusSymbols = false,
    collapsible = true,
    defaultCollapsed = Platform.OS === 'web'
}) => {
    const { theme } = useUnistyles();
    const wrapLines = useSetting('wrapLinesInDiffs');
    const [expanded, setExpanded] = React.useState(!defaultCollapsed);

    React.useEffect(() => {
        setExpanded(!defaultCollapsed);
    }, [defaultCollapsed, oldText, newText]);
    
    const diffView = (
        <DiffView 
            oldText={oldText} 
            newText={newText} 
            wrapLines={wrapLines}
            showLineNumbers={showLineNumbers}
            showPlusMinusSymbols={showPlusMinusSymbols}
            style={{ flex: 1, ...style }}
        />
    );

    if (!collapsible) {
        if (wrapLines) {
            return <View style={{ flex: 1 }}>{diffView}</View>;
        }
        return (
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={true}
                contentContainerStyle={{ flexGrow: 1 }}
            >
                {diffView}
            </ScrollView>
        );
    }

    const toggle = (
        <Pressable
            onPress={() => setExpanded((v) => !v)}
            style={({ pressed }) => [
                styles.toggle,
                { opacity: pressed ? 0.7 : 1 }
            ]}
        >
            <Text style={styles.toggleText}>{expanded ? 'Hide changes' : 'Show changes'}</Text>
            <Ionicons
                name={expanded ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={theme.colors.textSecondary}
            />
        </Pressable>
    );

    if (!expanded) {
        return <View style={styles.container}>{toggle}</View>;
    }
    
    if (wrapLines) {
        // When wrapping lines, no horizontal scroll needed
        return (
            <View style={styles.container}>
                {toggle}
                <View style={{ flex: 1 }}>{diffView}</View>
            </View>
        );
    }
    
    // When not wrapping, use horizontal scroll
    return (
        <View style={styles.container}>
            {toggle}
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={true}
                contentContainerStyle={{ flexGrow: 1 }}
            >
                {diffView}
            </ScrollView>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },
    toggle: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginHorizontal: 12,
        marginBottom: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 8,
        backgroundColor: theme.colors.surfaceHigh,
        borderWidth: 1,
        borderColor: theme.colors.divider,
    },
    toggleText: {
        fontSize: 13,
        fontWeight: '500',
        color: theme.colors.textSecondary,
    },
}));
