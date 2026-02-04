# Provider


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
from omni_generated.models.provider import Provider

# TODO update the JSON string below
json = "{}"
# create an instance of Provider from a JSON string
provider_instance = Provider.from_json(json)
# print the JSON string representation of the object
print(Provider.to_json())

# convert the object into a dict
provider_dict = provider_instance.to_dict()
# create an instance of Provider from a dict
provider_from_dict = Provider.from_dict(provider_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


