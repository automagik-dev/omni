# GetUserProfile200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**data** | [**GetUserProfile200ResponseData**](GetUserProfile200ResponseData.md) |  | 

## Example

```python
from omni_generated.models.get_user_profile200_response import GetUserProfile200Response

# TODO update the JSON string below
json = "{}"
# create an instance of GetUserProfile200Response from a JSON string
get_user_profile200_response_instance = GetUserProfile200Response.from_json(json)
# print the JSON string representation of the object
print(GetUserProfile200Response.to_json())

# convert the object into a dict
get_user_profile200_response_dict = get_user_profile200_response_instance.to_dict()
# create an instance of GetUserProfile200Response from a dict
get_user_profile200_response_from_dict = GetUserProfile200Response.from_dict(get_user_profile200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


