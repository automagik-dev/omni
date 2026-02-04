# GetInfo200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**version** | **str** | API version | 
**environment** | **str** | Environment | 
**uptime** | **int** | Uptime in seconds | 
**instances** | [**GetInfo200ResponseInstances**](GetInfo200ResponseInstances.md) |  | 
**events** | [**GetInfo200ResponseEvents**](GetInfo200ResponseEvents.md) |  | 

## Example

```python
from omni_generated.models.get_info200_response import GetInfo200Response

# TODO update the JSON string below
json = "{}"
# create an instance of GetInfo200Response from a JSON string
get_info200_response_instance = GetInfo200Response.from_json(json)
# print the JSON string representation of the object
print(GetInfo200Response.to_json())

# convert the object into a dict
get_info200_response_dict = get_info200_response_instance.to_dict()
# create an instance of GetInfo200Response from a dict
get_info200_response_from_dict = GetInfo200Response.from_dict(get_info200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


