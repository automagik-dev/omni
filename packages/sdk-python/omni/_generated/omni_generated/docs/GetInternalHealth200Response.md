# GetInternalHealth200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**status** | **str** | Health status | 
**service** | **str** | Service name | 
**pid** | **int** | Process ID | 
**memory** | [**GetInternalHealth200ResponseMemory**](GetInternalHealth200ResponseMemory.md) |  | 

## Example

```python
from omni_generated.models.get_internal_health200_response import GetInternalHealth200Response

# TODO update the JSON string below
json = "{}"
# create an instance of GetInternalHealth200Response from a JSON string
get_internal_health200_response_instance = GetInternalHealth200Response.from_json(json)
# print the JSON string representation of the object
print(GetInternalHealth200Response.to_json())

# convert the object into a dict
get_internal_health200_response_dict = get_internal_health200_response_instance.to_dict()
# create an instance of GetInternalHealth200Response from a dict
get_internal_health200_response_from_dict = GetInternalHealth200Response.from_dict(get_internal_health200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


