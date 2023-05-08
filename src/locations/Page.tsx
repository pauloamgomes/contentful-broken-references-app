import { useEffect, useReducer } from "react";
import {
  Flex,
  FormControl,
  Icon,
  InlineEntryCard,
  Paragraph,
  Radio,
} from "@contentful/f36-components";
import { Entry, PageAppSDK } from "@contentful/app-sdk";
import { useCMA, useSDK } from "@contentful/react-apps-toolkit";
import { createClient } from "contentful";
import {
  Button,
  SkeletonRow,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Text,
  TextLink,
} from "@contentful/f36-components";
import {
  Workbench,
  WorkbenchContent,
  WorkbenchHeader,
} from "@contentful/f36-workbench";
import {
  CycleTrimmedIcon,
  CheckCircleTrimmedIcon,
  ErrorCircleTrimmedIcon,
} from "@contentful/f36-icons";

interface IContentModel {
  id: string;
  name: string;
  linkFields: string[];
  displayField: string;
  status: "pending" | "ready";
  totalEntries?: number;
}

interface IState {
  contentModels: Record<string, IContentModel>;
  brokenReferences: Record<string, Entry[]>;
  status: "loading" | "loaded" | "error";
  locale: string;
}

function PageIcon() {
  return (
    <Icon variant="secondary">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
        <path d="M4.76 10.59a1 1 0 00.26-2l-1.76-.44a1 1 0 10-.52 1.93l1.76.47a.78.78 0 00.26.04zM8.62 5a1 1 0 001 .74.82.82 0 00.26 0 1 1 0 00.7-1.22l-.47-1.76a1 1 0 10-1.93.52zm4.83 10A1 1 0 0012 15l-3.5 3.56a2.21 2.21 0 01-3.06 0 2.15 2.15 0 010-3.06L9 12a1 1 0 10-1.41-1.41L4 14.08A4.17 4.17 0 109.92 20l3.53-3.53a1 1 0 000-1.47zM5.18 6.59a1 1 0 00.7.29 1 1 0 00.71-.29 1 1 0 000-1.41L5.3 3.89A1 1 0 003.89 5.3zm16.08 7.33l-1.76-.47a1 1 0 10-.5 1.93l1.76.47h.26a1 1 0 00.26-2zM15.38 19a1 1 0 00-1.23-.7 1 1 0 00-.7 1.22l.47 1.76a1 1 0 001 .74 1.15 1.15 0 00.26 0 1 1 0 00.71-1.23zm3.44-1.57a1 1 0 00-1.41 1.41l1.29 1.29a1 1 0 001.41 0 1 1 0 000-1.41zM21.2 7a4.16 4.16 0 00-7.12-3l-3.53 3.56A1 1 0 1012 9l3.5-3.56a2.21 2.21 0 013.06 0 2.15 2.15 0 010 3.06L15 12a1 1 0 000 1.41 1 1 0 001.41 0L20 9.92A4.19 4.19 0 0021.2 7z" />
      </svg>
    </Icon>
  );
}

const Page = () => {
  const sdk = useSDK<PageAppSDK>();
  const cma = useCMA();

  const defaultLocale = sdk.locales.default;
  const locales = sdk.locales.available;

  const [state, setState] = useReducer(
    (state: IState, newState: Partial<IState>) => ({
      ...state,
      ...newState,
    }),
    {
      contentModels: {},
      brokenReferences: {},
      status: "loading",
      locale: defaultLocale,
    }
  );

  const client = createClient({
    accessToken: sdk.parameters.installation.cdaToken,
    space: sdk.ids.space,
    environment: sdk.ids.environment,
  });

  const getAllContentModels = async () => {
    const models = {} as Record<string, IContentModel>;

    const contentTypes = await cma.contentType.getMany({});
    for (const contentType of contentTypes.items) {
      const linkFields = contentType.fields
        .filter((field) => !field.disabled)
        .filter(
          (field) =>
            field.type === "Link" ||
            (field.type === "Array" && field?.items?.type === "Link")
        )
        ?.map((field) => field.id);

      if (linkFields?.length > 0) {
        const entries = await client.getEntries({
          content_type: contentType.sys.id,
          limit: 1,
          select: ["sys.id"],
        });

        models[contentType.sys.id] = {
          id: contentType.sys.id,
          name: contentType.name,
          linkFields,
          displayField: contentType.displayField,
          status: "pending",
          totalEntries: entries.total,
        };
      }
    }

    return models;
  };

  const getContentModelBrokenReferences = async (
    contentModel: IContentModel
  ) => {
    const entries: Record<string, Entry> = {};
    const { id, linkFields } = contentModel;

    let skip = 0;
    let limit = 1000;

    let response = await client.getEntries({
      content_type: id,
      skip,
      limit,
      locale: state.locale,
    });

    while (response.items.length > 0) {
      if (response.errors) {
        const linkErrors = response.errors
          ?.filter((error) => error.details?.type === "Link")
          ?.map((error) => error.details?.id);

        response.items.forEach((item: any) => {
          const hasBrokenLink = linkFields.some((linkField: string) => {
            if (Array.isArray(item?.fields?.[linkField])) {
              return item?.fields?.[linkField]?.some((link: any) =>
                linkErrors.includes(link?.sys?.id)
              );
            }
            return linkErrors.includes(item?.fields?.[linkField]?.sys?.id);
          });

          if (hasBrokenLink) {
            entries[item.sys.id] = item;
          }
        });
      }

      skip += limit;

      response = await client.getEntries({
        content_type: id,
        skip,
        limit,
        locale: state.locale,
      });
    }

    return Object.values(entries);
  };

  const fetchBrokenReferences = async (
    contentModels: Record<string, IContentModel>
  ) => {
    const brokenReferences: Record<string, Entry[]> = {};

    for (const model of Object.values(contentModels)) {
      const entries = await getContentModelBrokenReferences(model);
      brokenReferences[model.id] = entries;
      model.status = "ready";

      setState({
        contentModels: { ...contentModels, [model.id]: model },
        brokenReferences,
      });
    }
  };

  const fetchAllBrokenReferences = async () => {
    setState({ status: "loading" });
    const contentModels = await getAllContentModels();
    setState({ contentModels, status: "loaded" });
    await fetchBrokenReferences(contentModels);
  };

  useEffect(() => {
    async function fetchData() {
      const contentModels = await getAllContentModels();
      setState({ contentModels, status: "loaded" });
      fetchBrokenReferences(contentModels);
    }

    fetchData();
  }, []);

  const { contentModels, brokenReferences, status, locale } = state;

  const processing =
    status === "loading" ||
    Object.values(contentModels).some((model) => model.status === "pending");

  return (
    <Workbench>
      <WorkbenchHeader
        title="Broken References"
        description="Find and fix broken references in your content"
        icon={PageIcon}
        actions={[
          <Button
            key="refresh"
            variant="primary"
            size="small"
            startIcon={processing ? <Spinner /> : <CycleTrimmedIcon />}
            onClick={fetchAllBrokenReferences}
            isDisabled={processing}
          >
            Refresh
          </Button>,
        ]}
      />
      <Workbench.Sidebar>
        <FormControl as="fieldset">
          <FormControl.Label as="legend" marginBottom="none">
            Locale
          </FormControl.Label>
          <Paragraph>Set the locale to perform the analysis</Paragraph>
          <Radio.Group
            name="permission"
            value={locale}
            onChange={(e) => {
              setState({ locale: e.target.value });
            }}
          >
            <Radio
              value={defaultLocale}
              isDisabled={processing}
              helpText="Default locale"
            >
              {sdk.locales.names[locale]}
            </Radio>
            {locales
              .filter((locale) => locale !== defaultLocale)
              .map((locale) => (
                <Radio key={locale} value={locale} isDisabled={processing}>
                  {sdk.locales.names[locale]}
                </Radio>
              ))}
          </Radio.Group>
        </FormControl>
      </Workbench.Sidebar>
      <WorkbenchContent>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Content Model</TableCell>
              <TableCell>Total entries</TableCell>
              <TableCell>Link Fields</TableCell>
              <TableCell>Broken References</TableCell>
              <TableCell></TableCell>
            </TableRow>
          </TableHead>
          {status !== "loaded" && (
            <TableBody>
              <SkeletonRow columnCount={3} rowCount={10} />
            </TableBody>
          )}
          {status === "loaded" && (
            <TableBody>
              {Object.entries(contentModels)?.map(([id, model]) => (
                <TableRow key={id}>
                  <TableCell>
                    <TextLink
                      as="a"
                      href={`https://app.contentful.com/spaces/${sdk.ids.space}/environments/${sdk.ids.environment}/content_types/${id}/fields`}
                      target="_blank"
                    >
                      {model?.name}
                    </TextLink>
                  </TableCell>
                  <TableCell>
                    <TextLink
                      as="a"
                      href={`https://app.contentful.com/spaces/${sdk.ids.space}/environments/${sdk.ids.environment}/entries?contentTypeId=${id}`}
                      target="_blank"
                    >
                      {model?.totalEntries}
                    </TextLink>
                  </TableCell>
                  <TableCell>
                    <Text fontSize="fontSizeS">
                      {model?.linkFields?.join(", ")}
                    </Text>
                  </TableCell>
                  <TableCell>
                    {model.status === "pending" && (
                      <Text fontSize="fontSizeS">
                        <Spinner />
                      </Text>
                    )}
                    {model.status === "ready" && (
                      <>
                        {brokenReferences?.[id]?.length ? (
                          <Flex alignItems="center">
                            <Flex marginRight="spacingXs">
                              <ErrorCircleTrimmedIcon variant="negative" />
                            </Flex>
                            <Text
                              fontColor={
                                brokenReferences?.[id]?.length
                                  ? "red600"
                                  : "gray900"
                              }
                              fontSize="fontSizeS"
                            >
                              {brokenReferences?.[id]?.length} broken references
                            </Text>
                          </Flex>
                        ) : (
                          <CheckCircleTrimmedIcon variant="positive" />
                        )}
                      </>
                    )}
                  </TableCell>
                  <TableCell>
                    {brokenReferences?.[id]?.length > 0 && (
                      <div style={{ paddingTop: "0.275rem" }}>
                        {brokenReferences[id]?.map((entry) => (
                          <div
                            key={entry.sys.id}
                            style={{
                              display: "inline-block",
                              paddingRight: "0.5rem",
                              marginBottom: "0.5rem",
                            }}
                          >
                            <InlineEntryCard
                              status="deleted"
                              actions={[]}
                              onClick={() =>
                                sdk.navigator.openEntry(entry.sys.id, {
                                  slideIn: true,
                                })
                              }
                              margin="spacingS"
                            >
                              {entry?.fields?.[model.displayField]}
                            </InlineEntryCard>
                          </div>
                        ))}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          )}
        </Table>
      </WorkbenchContent>
    </Workbench>
  );
};

export default Page;
