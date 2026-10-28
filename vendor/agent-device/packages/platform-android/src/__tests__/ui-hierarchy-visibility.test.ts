import { expect, test } from 'vitest';
import { buildUiHierarchySnapshot, parseUiHierarchyTree } from '../ui-hierarchy.ts';

function labels(xml: string): string[] {
  const { nodes } = buildUiHierarchySnapshot(parseUiHierarchyTree(xml), undefined, {});
  return nodes.map((node) => node.label).filter((label): label is string => Boolean(label));
}

test('a same-package popup above the focused window stays visible', () => {
  const visible = labels(`<hierarchy>
    <node class="android.view.ViewGroup" package="com.example" bounds="[24,1203][592,2046]"
      window-type="1" window-layer="1" window-active="false" window-focused="false"
      visible-to-user="true">
      <node class="android.widget.TextView" package="com.example" text="Gallery"
        bounds="[222,1435][385,1499]" clickable="true" visible-to-user="true" />
    </node>
    <node class="android.widget.FrameLayout" package="com.example" bounds="[0,0][1080,2340]"
      window-type="1" window-layer="0" window-active="true" window-focused="true"
      visible-to-user="true">
      <node class="android.widget.Button" package="com.example" text="Send"
        bounds="[900,2000][1050,2100]" clickable="true" visible-to-user="true" />
    </node>
  </hierarchy>`);

  expect(visible).toContain('Gallery');
  expect(visible).toContain('Send');
});

test('a stale application window below the focused window stays hidden', () => {
  const visible = labels(`<hierarchy>
    <node class="android.widget.FrameLayout" package="com.example" bounds="[0,0][1080,2340]"
      window-type="1" window-layer="1" window-active="true" window-focused="true"
      visible-to-user="true">
      <node class="android.widget.Button" package="com.example" text="Current"
        bounds="[20,20][300,120]" clickable="true" visible-to-user="true" />
    </node>
    <node class="android.widget.FrameLayout" package="com.example" bounds="[0,0][1080,2340]"
      window-type="1" window-layer="0" window-active="false" window-focused="false"
      visible-to-user="true">
      <node class="android.widget.Button" package="com.example" text="Stale"
        bounds="[20,200][300,300]" clickable="true" visible-to-user="true" />
    </node>
  </hierarchy>`);

  expect(visible).toContain('Current');
  expect(visible).not.toContain('Stale');
});

test('another app window above the focused window stays hidden', () => {
  const visible = labels(`<hierarchy>
    <node class="android.widget.FrameLayout" package="com.other" bounds="[0,0][540,1170]"
      window-type="1" window-layer="2" window-active="false" window-focused="false"
      visible-to-user="true">
      <node class="android.widget.Button" package="com.other" text="Foreign"
        bounds="[20,20][300,120]" clickable="true" visible-to-user="true" />
    </node>
    <node class="android.widget.FrameLayout" package="com.example" bounds="[0,0][1080,2340]"
      window-type="1" window-layer="1" window-active="true" window-focused="true"
      visible-to-user="true">
      <node class="android.widget.Button" package="com.example" text="Current"
        bounds="[20,200][300,300]" clickable="true" visible-to-user="true" />
    </node>
  </hierarchy>`);

  expect(visible).toContain('Current');
  expect(visible).not.toContain('Foreign');
});
