# InternalHealthResponse


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**status** | **str** | Health status | 
**service** | **str** | Service name | 
**pid** | **int** | Process ID | 
**memory** | [**GetInternalHealth200ResponseMemory**](GetInternalHealth200ResponseMemory.md) |  | 

## Example

```python
from omni_generated.models.internal_health_response import InternalHealthResponse

# TODO update the JSON string below
json = "{}"
# create an instance of InternalHealthResponse from a JSON string
internal_health_response_instance = InternalHealthResponse.from_json(json)
# print the JSON string representation of the object
print(InternalHealthResponse.to_json())

# convert the object into a dict
internal_health_response_dict = internal_health_response_instance.to_dict()
# create an instance of InternalHealthResponse from a dict
internal_health_response_from_dict = InternalHealthResponse.from_dict(internal_health_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


