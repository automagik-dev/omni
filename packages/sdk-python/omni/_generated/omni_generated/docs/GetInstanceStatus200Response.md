# GetInstanceStatus200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**data** | [**GetInstanceStatus200ResponseData**](GetInstanceStatus200ResponseData.md) |  | 

## Example

```python
from omni_generated.models.get_instance_status200_response import GetInstanceStatus200Response

# TODO update the JSON string below
json = "{}"
# create an instance of GetInstanceStatus200Response from a JSON string
get_instance_status200_response_instance = GetInstanceStatus200Response.from_json(json)
# print the JSON string representation of the object
print(GetInstanceStatus200Response.to_json())

# convert the object into a dict
get_instance_status200_response_dict = get_instance_status200_response_instance.to_dict()
# create an instance of GetInstanceStatus200Response from a dict
get_instance_status200_response_from_dict = GetInstanceStatus200Response.from_dict(get_instance_status200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


