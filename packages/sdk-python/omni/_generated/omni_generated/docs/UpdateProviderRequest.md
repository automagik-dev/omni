# UpdateProviderRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **str** | Provider name | [optional] 
**var_schema** | **str** | Schema type | [optional] [default to 'agnoos']
**base_url** | **str** | Base URL | [optional] 
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
from omni_generated.models.update_provider_request import UpdateProviderRequest

# TODO update the JSON string below
json = "{}"
# create an instance of UpdateProviderRequest from a JSON string
update_provider_request_instance = UpdateProviderRequest.from_json(json)
# print the JSON string representation of the object
print(UpdateProviderRequest.to_json())

# convert the object into a dict
update_provider_request_dict = update_provider_request_instance.to_dict()
# create an instance of UpdateProviderRequest from a dict
update_provider_request_from_dict = UpdateProviderRequest.from_dict(update_provider_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


