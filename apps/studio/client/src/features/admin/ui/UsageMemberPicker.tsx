import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { listAdminMemberUsers } from "../services/adminMemberApi";

/** Members fetched per search; the list is searched on the server, not filtered locally. */
const MEMBER_OPTION_LIMIT = 200;

type MemberOption = { user_id: string; username: string; display_name?: string };

const memberLabel = (member: MemberOption) => member.display_name || member.username;

export function UsageMemberPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (userId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<MemberOption | null>(null);
  const members = useQuery({
    queryKey: ["admin", "usage-members", search],
    queryFn: () => listAdminMemberUsers(1, MEMBER_OPTION_LIMIT, { search }),
  });
  const items: MemberOption[] = members.data?.items ?? [];
  const selected =
    picked?.user_id === value ? picked : items.find(member => member.user_id === value);
  const choose = (member: MemberOption | null) => {
    setPicked(member);
    onChange(member?.user_id ?? "");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="usage-member-trigger"
          aria-label="成员"
          aria-expanded={open}
          title={selected ? `${memberLabel(selected)} · ${selected.username}` : value || "全部成员"}
        >
          <span className={value ? "" : "is-placeholder"}>
            {selected ? (
              <>
                {memberLabel(selected)}
                <small>{selected.username}</small>
              </>
            ) : (
              value || "全部成员"
            )}
          </span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="usage-member-popover">
        <Command shouldFilter={false}>
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder="搜索账号、昵称或成员 ID"
            aria-label="查找成员"
          />
          <CommandList>
            {members.isError ? (
              <div className="usage-member-state">
                成员加载失败
                <button type="button" onClick={() => void members.refetch()}>
                  重试
                </button>
              </div>
            ) : members.isPending ? (
              <div className="usage-member-state">正在加载成员…</div>
            ) : (
              <>
                <CommandEmpty>没有匹配的成员</CommandEmpty>
                <CommandGroup>
                  {!search && (
                    <CommandItem value="__all__" onSelect={() => choose(null)}>
                      <span className="usage-member-name">全部成员</span>
                      {!value && <Check aria-hidden="true" />}
                    </CommandItem>
                  )}
                  {items.map(member => (
                    <CommandItem
                      key={member.user_id}
                      value={member.user_id}
                      onSelect={() => choose(member)}
                    >
                      <span className="usage-member-name">
                        {memberLabel(member)}
                        <small>{member.username}</small>
                      </span>
                      {member.user_id === value && <Check aria-hidden="true" />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
