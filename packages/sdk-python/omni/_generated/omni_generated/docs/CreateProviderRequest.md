# CreateProviderRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **str** | Provider name | 
**var_schema** | **str** | Schema type | [optional] [default to 'agnoos']
**base_url** | **str** | Base URL | 
**api_key** | **str** | API key (encrypted) | [optional] 
**schema_config** | **Dict[str, Optional[object]]** | Schema config | [optional] 
**default_stream** | **bool** | Default streaming | [optional] [default to True]
**default_timeout** | **int** | Default timeout | [optional] [default to 60]
**supports_streaming** | **bool** | Supports streaming | [optional] [default to True]
**supports_images** | **bool** | Supports images | [optional] [default to False]
**supports_audio** | **bool** | Supports audio | [optional] [default to False]
**supports_documents** | **bool** | Supports documents | [optional] [default to False]
**description** | **str** | Description | [optional] 
**tags** | **List[str]** | Tags | [optional] 

## Example

```python
from omni_generated.models.create_provider_request import CreateProviderRequest

# TODO update the JSON string below
json = "{}"
# create an instance of CreateProviderRequest from a JSON string
create_provider_request_instance = CreateProviderRequest.from_json(json)
# print the JSON string representation of the object
print(CreateProviderRequest.to_json())

# convert the object into a dict
create_provider_request_dict = create_provider_request_instance.to_dict()
# create an instance of CreateProviderRequest from a dict
create_provider_request_from_dict = CreateProviderRequest.from_dict(create_provider_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


