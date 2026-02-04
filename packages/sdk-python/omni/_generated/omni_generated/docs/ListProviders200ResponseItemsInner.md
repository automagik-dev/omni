# ListProviders200ResponseItemsInner


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **UUID** | Provider UUID | 
**name** | **str** | Provider name | 
**var_schema** | **str** | Provider schema type | 
**base_url** | **str** | Base URL | 
**api_key** | **str** | API key (masked) | 
**schema_config** | **Dict[str, Optional[object]]** | Schema config | 
**default_stream** | **bool** | Default streaming | 
**default_timeout** | **int** | Default timeout (seconds) | 
**supports_streaming** | **bool** | Supports streaming | 
**supports_images** | **bool** | Supports images | 
**supports_audio** | **bool** | Supports audio | 
**supports_documents** | **bool** | Supports documents | 
**description** | **str** | Description | 
**tags** | **List[str]** | Tags | 
**is_active** | **bool** | Whether active | 
**created_at** | **datetime** | Creation timestamp | 
**updated_at** | **datetime** | Last update timestamp | 

## Example

```python
from omni_generated.models.list_providers200_response_items_inner import ListProviders200ResponseItemsInner

# TODO update the JSON string below
json = "{}"
# create an instance of ListProviders200ResponseItemsInner from a JSON string
list_providers200_response_items_inner_instance = ListProviders200ResponseItemsInner.from_json(json)
# print the JSON string representation of the object
print(ListProviders200ResponseItemsInner.to_json())

# convert the object into a dict
list_providers200_response_items_inner_dict = list_providers200_response_items_inner_instance.to_dict()
# create an instance of ListProviders200ResponseItemsInner from a dict
list_providers200_response_items_inner_from_dict = ListProviders200ResponseItemsInner.from_dict(list_providers200_response_items_inner_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


